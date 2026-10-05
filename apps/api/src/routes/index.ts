import {
  LEGAL_DOCUMENT_TYPES,
  legalDocumentInputSchema,
  localeCodeSchema,
  matchInputSchema,
  paginationSchema,
  paymentInstructionInputSchema,
  updateLanguageInputSchema,
  uuidSchema,
} from '@foodboll/contracts';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client';
import { requireRole, requireUser } from '../context';
import { listEnabledLanguages } from '../services/languages';
import { publishLegalDocument, getCurrentLegalDocument } from '../services/legal';
import {
  createMatch,
  getMatch,
  getMatchTranslations,
  listUpcomingMatches,
  replaceMatch,
} from '../services/matches';
import {
  getActivePaymentInstruction,
  getActivePaymentInstructionForAdmin,
  replacePaymentInstructions,
} from '../services/payment-instructions';
import { listUsersForAdmin, toMeDto, updateUserLanguage } from '../services/users';

const idParams = z.object({ id: uuidSchema });
const legalParams = z.object({ type: z.enum(LEGAL_DOCUMENT_TYPES) });
const adminUsersQuery = paginationSchema.extend({
  language: z.union([localeCodeSchema, z.literal('none')]).optional(),
});

export function registerRoutes(app: FastifyInstance, db: Db): void {
  // ---- Languages & the current user ------------------------------------------------------
  app.get('/v1/languages', async () => ({ items: await listEnabledLanguages(db) }));

  app.get('/v1/me', async (request) => toMeDto(requireUser(request), request.ctx.locale));

  app.patch('/v1/me/language', async (request) => {
    const user = requireUser(request);
    const input = updateLanguageInputSchema.parse(request.body);
    const updated = await updateUserLanguage(db, user.id, input);
    return toMeDto(updated, updated.preferredLanguage ?? request.ctx.locale);
  });

  // ---- Matches -----------------------------------------------------------------------------
  app.get('/v1/matches', async (request) =>
    listUpcomingMatches(db, request.ctx.locale, paginationSchema.parse(request.query)),
  );

  app.get('/v1/matches/:id', async (request) =>
    getMatch(db, idParams.parse(request.params).id, request.ctx.locale),
  );

  app.get('/v1/matches/:id/translations', async (request) =>
    getMatchTranslations(
      db,
      requireRole(request, 'ORGANIZER', 'ADMIN'),
      idParams.parse(request.params).id,
    ),
  );

  app.post('/v1/matches', async (request, reply) => {
    const user = requireRole(request, 'ORGANIZER', 'ADMIN');
    const id = await createMatch(db, user.id, matchInputSchema.parse(request.body));
    return reply
      .status(201)
      .header('Location', `/v1/matches/${id}`)
      .send(await getMatch(db, id, request.ctx.locale));
  });

  app.put('/v1/matches/:id', async (request) => {
    const user = requireRole(request, 'ORGANIZER', 'ADMIN');
    const { id } = idParams.parse(request.params);
    await replaceMatch(db, user, id, matchInputSchema.parse(request.body));
    return getMatch(db, id, request.ctx.locale);
  });

  // ---- Payment instructions ----------------------------------------------------------------
  app.get('/v1/payment-instructions/current', async (request) => {
    requireUser(request);
    return getActivePaymentInstruction(db, request.ctx.locale);
  });

  app.get('/v1/admin/payment-instructions/current', async (request) => {
    requireRole(request, 'ADMIN');
    return getActivePaymentInstructionForAdmin(db);
  });

  app.put('/v1/admin/payment-instructions', async (request) => {
    const admin = requireRole(request, 'ADMIN');
    await replacePaymentInstructions(db, admin.id, paymentInstructionInputSchema.parse(request.body));
    return getActivePaymentInstructionForAdmin(db);
  });

  // ---- Legal documents (terms, privacy, cancellation, refund) -----------------------------
  app.get('/v1/legal/:type', async (request) =>
    getCurrentLegalDocument(db, legalParams.parse(request.params).type, request.ctx.locale),
  );

  app.put('/v1/admin/legal/:type', async (request, reply) => {
    const admin = requireRole(request, 'ADMIN');
    const { type } = legalParams.parse(request.params);
    await publishLegalDocument(db, admin.id, type, legalDocumentInputSchema.parse(request.body));
    return reply.status(201).send(await getCurrentLegalDocument(db, type, request.ctx.locale));
  });

  // ---- Admin: users and their languages ---------------------------------------------------
  app.get('/v1/admin/users', async (request) => {
    requireRole(request, 'ADMIN');
    return listUsersForAdmin(db, adminUsersQuery.parse(request.query));
  });
}
