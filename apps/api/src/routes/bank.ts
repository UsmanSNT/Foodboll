import {
  assignDepositInputSchema,
  bankNotificationInputSchema,
  depositorNameInputSchema,
  depositStatusFilterSchema,
  paginationSchema,
  uuidSchema,
} from '@foodboll/contracts';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config';
import { requireRole, requireUser } from '../context';
import type { Db } from '../db/client';
import { AppError } from '../errors';
import {
  assignDeposit,
  ignoreDeposit,
  ingestBankMessage,
  listBankDeposits,
} from '../services/bank-deposits';
import { buildMe, findUserById, setDepositorName } from '../services/users';

function secretMatches(header: string | undefined, secret: string): boolean {
  const match = /^Bearer (.+)$/.exec(header ?? '');
  if (!match?.[1]) return false;
  const a = createHash('sha256').update(match[1]).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}

const adminDepositsQuery = paginationSchema.extend({
  status: depositStatusFilterSchema.default('UNMATCHED'),
});
const idParams = z.object({ id: uuidSchema });

export function registerBankRoutes(app: FastifyInstance, db: Db, config: AppConfig): void {
  /**
   * Receives a bank notification forwarded from the receiving account's phone. Authenticated by a
   * shared secret (not a user session). Responds with the outcome only; message text is never echoed.
   */
  app.post('/v1/integrations/bank-notifications', { bodyLimit: 16 * 1024 }, async (request) => {
    const secret = config.bank.webhookSecret;
    // 404 when the feature is off, so scanners learn nothing; 401 for a wrong secret.
    if (!secret) throw new AppError('NOT_FOUND', 404);
    if (!secretMatches(request.headers.authorization, secret))
      throw new AppError('UNAUTHENTICATED', 401);

    const input = bankNotificationInputSchema.parse(request.body);
    const allowed = config.bank.allowedSenders;
    if (allowed.length > 0 && !(input.sender && allowed.includes(input.sender))) {
      return { status: 'DROPPED', duplicate: false };
    }
    const result = await ingestBankMessage(db, config.bank, {
      source: 'WEBHOOK',
      text: input.text,
      receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
      externalId: input.messageId,
    });
    return { status: result.status, duplicate: result.duplicate };
  });

  app.get('/v1/admin/bank-deposits', async (request) => {
    requireRole(request, 'ADMIN');
    return listBankDeposits(db, adminDepositsQuery.parse(request.query));
  });

  app.post('/v1/admin/bank-deposits/:id/assign', async (request) => {
    const admin = requireRole(request, 'ADMIN');
    const { id } = idParams.parse(request.params);
    const { registrationId } = assignDepositInputSchema.parse(request.body);
    return assignDeposit(db, admin, id, registrationId);
  });

  app.post('/v1/admin/bank-deposits/:id/ignore', async (request) => {
    const admin = requireRole(request, 'ADMIN');
    return ignoreDeposit(db, admin, idParams.parse(request.params).id);
  });

  app.patch('/v1/me/depositor-name', async (request) => {
    const user = requireUser(request);
    const { depositorName } = depositorNameInputSchema.parse(request.body);
    await setDepositorName(db, user.id, depositorName);
    return buildMe(db, (await findUserById(db, user.id)) ?? user, request.ctx.locale);
  });
}
