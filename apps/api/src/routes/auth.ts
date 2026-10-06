import {
  devLoginInputSchema,
  markNotificationsReadInputSchema,
  paginationSchema,
  telegramLoginInputSchema,
  type AuthTokenDto,
} from '@foodboll/contracts';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config';
import { requireUser } from '../context';
import type { Db } from '../db/client';
import { AppError } from '../errors';
import type { TelegramClient } from '../integrations/telegram';
import {
  devLogin,
  issueSession,
  loginWithTelegram,
  revokeAllSessions,
  revokeSession,
} from '../services/auth';
import { listInbox, markInboxRead } from '../services/notifications';
import { handleTelegramUpdate } from '../services/telegram-bot';
import { buildMe } from '../services/users';
import { eq } from 'drizzle-orm';
import { userIdentities, users } from '../db/schema';

export interface AuthRouteDeps {
  readonly db: Db;
  readonly config: AppConfig;
  readonly telegram: TelegramClient | null;
}

/** Constant-time string comparison that does not leak the secret's length. */
function secretsMatch(given: string | undefined, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  const { db, config } = deps;
  const LOGIN_RATE_LIMIT = { max: config.loginRateLimitPerMinute, timeWindow: '1 minute' };

  async function tokenFor(
    user: Parameters<typeof issueSession>[2],
    locale: Parameters<typeof buildMe>[2],
  ): Promise<AuthTokenDto> {
    const { accessToken, expiresAt } = await issueSession(db, config, user);
    return {
      accessToken,
      expiresAt: expiresAt.toISOString(),
      user: await buildMe(db, user, locale),
    };
  }

  /** What the web client needs to render its sign-in options. */
  app.get('/v1/auth/config', async () => ({
    telegramBotUsername: config.telegram?.botUsername ?? null,
    devLogin: config.devLogin,
  }));

  app.post('/v1/auth/telegram', { config: { rateLimit: LOGIN_RATE_LIMIT } }, async (request) => {
    const user = await loginWithTelegram(db, config, telegramLoginInputSchema.parse(request.body));
    return tokenFor(user, request.ctx.locale);
  });

  app.post('/v1/auth/dev-login', { config: { rateLimit: LOGIN_RATE_LIMIT } }, async (request) => {
    const user = await devLogin(db, config, devLoginInputSchema.parse(request.body));
    return tokenFor(user, request.ctx.locale);
  });

  app.post('/v1/auth/logout', async (request) => {
    requireUser(request);
    if (request.ctx.sessionId) await revokeSession(db, request.ctx.sessionId);
    return { ok: true };
  });

  app.post('/v1/auth/logout-all', async (request) => {
    await revokeAllSessions(db, requireUser(request).id);
    return { ok: true };
  });

  // ---- Telegram bot ----------------------------------------------------------------------
  /** Whether and how this user can receive Telegram notifications. */
  app.get('/v1/me/telegram', async (request) => {
    const user = requireUser(request);
    const [identity] = await db
      .select({ subject: userIdentities.subject, startedAt: users.telegramStartedAt })
      .from(userIdentities)
      .innerJoin(users, eq(users.id, userIdentities.userId))
      .where(eq(userIdentities.userId, user.id));
    const bot = config.telegram?.botUsername ?? null;
    return {
      available: bot !== null,
      /** Signed in with Telegram, so the bot can recognise them. */
      linked: identity !== undefined,
      notificationsEnabled: identity?.startedAt != null,
      botLink: bot ? `https://t.me/${bot}?start=app` : null,
    };
  });

  app.post('/v1/integrations/telegram/webhook', async (request, reply) => {
    const secret = config.telegram?.webhookSecret;
    const header = request.headers['x-telegram-bot-api-secret-token'];
    if (
      !secret ||
      !deps.telegram ||
      !secretsMatch(typeof header === 'string' ? header : undefined, secret)
    ) {
      throw new AppError('UNAUTHENTICATED', 401);
    }
    try {
      await handleTelegramUpdate(
        {
          db,
          client: deps.telegram,
          onError: (error) => request.log.warn({ err: error }, 'telegram reply failed'),
        },
        request.body,
      );
    } catch (error) {
      // Acknowledge anyway: a 5xx makes Telegram redeliver the same update in a loop.
      request.log.error({ err: error }, 'telegram update handling failed');
    }
    return reply.status(200).send({ ok: true });
  });

  // ---- In-app notifications --------------------------------------------------------------
  app.get('/v1/me/notifications', async (request) =>
    listInbox(db, requireUser(request), request.ctx.locale, paginationSchema.parse(request.query)),
  );

  app.post('/v1/me/notifications/read', async (request) => {
    await markInboxRead(
      db,
      requireUser(request),
      markNotificationsReadInputSchema.parse(request.body),
    );
    return { ok: true };
  });
}
