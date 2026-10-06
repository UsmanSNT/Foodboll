import type { UserRole } from '@foodboll/contracts';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LocaleCode } from '@foodboll/i18n';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { inject } from 'vitest';
import { buildApp } from '../src/app';
import type { TelegramClient } from '../src/integrations/telegram';
import { signAccessToken } from '../src/services/auth';
import type { AppConfig } from '../src/config';
import type { AuthUser } from '../src/context';
import { createDb, type DbHandle } from '../src/db/client';
import { authSessions, matches, matchTranslations, userIdentities, users } from '../src/db/schema';

export const TEST_BOT_TOKEN = '123456789:test-bot-token-for-hmac-verification';
export const TEST_BANK_SECRET = 'bank-webhook-secret-0123456789-abcdefghij';
export const TEST_BANK_CHAT_ID = '-1001234567890';
export const TEST_WEBHOOK_SECRET = 'test-webhook-secret-0123456789';

export const TEST_CONFIG = (databaseUrl: string): AppConfig => ({
  nodeEnv: 'test',
  port: 0,
  host: '127.0.0.1',
  logLevel: 'silent',
  databaseUrl,
  jwtSecret: 'test-secret-test-secret-test-secret-1234',
  jwtIssuer: 'foodboll',
  jwtAudience: 'foodboll-api',
  corsOrigins: ['http://localhost:5173'],
  receiptDir: mkdtempSync(path.join(os.tmpdir(), 'foodboll-receipts-')),
  loginRateLimitPerMinute: 10_000,
  bank: {
    webhookSecret: TEST_BANK_SECRET,
    allowedSenders: [],
    telegramChatId: TEST_BANK_CHAT_ID,
    autoConfirmLimitPer10Min: 30,
    maxMessageAgeHours: 36,
  },
  sessionDays: 30,
  devLogin: true,
  telegram: {
    botToken: TEST_BOT_TOKEN,
    botUsername: 'foodboll_test_bot',
    webhookSecret: TEST_WEBHOOK_SECRET,
  },
  matchFeeKrw: 10_000,
  rateLimitPerMinute: 10_000,
  uploadRateLimitPerMinute: 10_000,
  trustProxy: false,
});

export interface TestContext {
  readonly app: FastifyInstance;
  readonly handle: DbHandle;
  readonly config: AppConfig;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function startTestApp(
  overrides: Partial<AppConfig> = {},
  deps: { telegram?: TelegramClient | null } = {},
): Promise<TestContext> {
  const config = { ...TEST_CONFIG(inject('databaseUrl')), ...overrides };
  const handle = createDb(config.databaseUrl, { max: 4 });
  // Tests never reach the real Telegram API: default to a recording fake unless overridden.
  const app = buildApp(config, handle.db, { telegram: deps.telegram ?? null });
  await app.ready();
  return {
    app,
    handle,
    config,
    // `languages` is seed data owned by migrations, so it is kept.
    reset: async () => {
      await handle.pool.query(
        'truncate table organizer_applications, organizer_regions, bank_deposits, telegram_login_replays, auth_sessions, user_identities, notifications, registration_payments, match_registrations, legal_document_translations, legal_documents, payment_instruction_translations, payment_instructions, match_translations, matches, users cascade',
      );
      // Reference data that individual tests may toggle.
      await handle.pool.query('update regions set enabled = true');
      await handle.pool.query('update languages set enabled = true');
    },
    close: async () => {
      await app.close();
      await handle.close();
    },
  };
}

export async function createUser(
  ctx: TestContext,
  data: {
    role?: UserRole;
    displayName?: string;
    preferredLanguage?: LocaleCode | null;
    deviceLocale?: string | null;
    /** Create a Telegram identity (so the bot recognises this user). */
    telegramId?: string;
    /** The user pressed Start in the bot. */
    telegramStarted?: boolean;
    /** Region codes an ORGANIZER may publish in. Default: every province. */
    organizerRegions?: string[];
  } = {},
): Promise<{ id: string; token: string; sessionId: string }> {
  const [row] = await ctx.handle.db
    .insert(users)
    .values({
      displayName: data.displayName ?? 'Test User',
      role: data.role ?? 'PLAYER',
      preferredLanguage: data.preferredLanguage ?? null,
      deviceLocale: data.deviceLocale ?? null,
      telegramStartedAt: data.telegramStarted ? new Date() : null,
    })
    .returning({ id: users.id });
  if (!row) throw new Error('user insert failed');
  if ((data.role ?? 'PLAYER') === 'ORGANIZER') {
    const codes = data.organizerRegions;
    await ctx.handle.pool.query(
      `insert into organizer_regions (user_id, region_id)
       select $1, id from regions where ${codes ? 'code = any($2)' : 'level = 1 and $2::text[] is null'}`,
      [row.id, codes ?? null],
    );
  }
  if (data.telegramId) {
    await ctx.handle.db
      .insert(userIdentities)
      .values({ provider: 'TELEGRAM', subject: data.telegramId, userId: row.id });
  }
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const [session] = await ctx.handle.db
    .insert(authSessions)
    .values({ userId: row.id, expiresAt })
    .returning({ id: authSessions.id });
  if (!session) throw new Error('session insert failed');
  return {
    id: row.id,
    sessionId: session.id,
    token: await signAccessToken(ctx.config, row.id, session.id, expiresAt),
  };
}

export function signToken(
  config: AppConfig,
  subject: string,
  options: {
    secret?: string;
    issuer?: string;
    audience?: string;
    expiresIn?: string;
    jti?: string;
  } = {},
): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(subject)
    .setJti(options.jti ?? crypto.randomUUID())
    .setIssuer(options.issuer ?? config.jwtIssuer)
    .setAudience(options.audience ?? config.jwtAudience)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '1h')
    .sign(new TextEncoder().encode(options.secret ?? config.jwtSecret));
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** Inserts a match directly (bypassing the API) so tests control time, price and capacity. */
export async function insertMatch(
  ctx: TestContext,
  organizerId: string,
  options: {
    feeKrw?: number;
    maxPlayers?: number;
    startsAt?: Date;
    title?: string;
    region?: string;
    venueName?: string;
  } = {},
): Promise<string> {
  const startsAt = options.startsAt ?? new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const region = (
    await ctx.handle.pool.query('select id from regions where code = $1', [
      options.region ?? 'seoul',
    ])
  ).rows[0] as { id: string };
  const [row] = await ctx.handle.db
    .insert(matches)
    .values({
      organizerId,
      regionId: region.id,
      sourceLanguage: 'ko',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 2 * 3600 * 1000),
      venueName: options.venueName ?? '테스트 풋살장',
      playersPerSide: 5,
      maxPlayers: options.maxPlayers ?? 10,
      feeKrw: options.feeKrw ?? 10000,
    })
    .returning({ id: matches.id });
  if (!row) throw new Error('match insert failed');
  await ctx.handle.db.insert(matchTranslations).values({
    matchId: row.id,
    languageCode: 'ko',
    title: options.title ?? '서울 풋살장 5v5 매치',
  });
  return row.id;
}

/** Smallest valid PNG header + padding; enough for type sniffing. */
export const pngBytes = (extra = 16) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(extra, 1),
  ]);
export const jpegBytes = () =>
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
export const pdfBytes = () => Buffer.from('%PDF-1.4\n%fake\n');

/** Records messages instead of calling Telegram; `fail` lets a test script errors per call. */
export class FakeTelegram implements TelegramClient {
  readonly sent: { chatId: string; text: string }[] = [];
  fail: ((chatId: string, text: string) => Error | null) | null = null;
  delayMs = 0;

  async sendMessage(chatId: string, text: string): Promise<void> {
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const error = this.fail?.(chatId, text) ?? null;
    if (error) throw error;
    this.sent.push({ chatId, text });
  }
}

/** A Telegram Login Widget payload signed exactly as Telegram signs it. */
export function telegramLoginPayload(
  fields: {
    id: number | string;
    first_name?: string;
    last_name?: string;
    username?: string;
    auth_date?: number;
  },
  botToken: string = TEST_BOT_TOKEN,
): Record<string, string | number> {
  const data: Record<string, string | number> = {
    ...fields,
    auth_date: fields.auth_date ?? Math.floor(Date.now() / 1000),
  };
  const checkString = Object.entries(data)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');
  const secret = createHash('sha256').update(botToken).digest();
  return { ...data, hash: createHmac('sha256', secret).update(checkString).digest('hex') };
}

/** A service-level actor for tests that call services directly instead of going over HTTP. */
export function authUser(user: { id: string }, role: AuthUser['role'] = 'PLAYER'): AuthUser {
  return {
    id: user.id,
    role,
    displayName: 'Test',
    preferredLanguage: null,
    homeRegionId: null,
    depositorName: null,
  };
}
