import type { UserRole } from '@foodboll/contracts';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LocaleCode } from '@foodboll/i18n';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { inject } from 'vitest';
import { buildApp } from '../src/app';
import type { AppConfig } from '../src/config';
import { createDb, type DbHandle } from '../src/db/client';
import { matches, matchTranslations, users } from '../src/db/schema';

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

export async function startTestApp(overrides: Partial<AppConfig> = {}): Promise<TestContext> {
  const config = { ...TEST_CONFIG(inject('databaseUrl')), ...overrides };
  const handle = createDb(config.databaseUrl, { max: 4 });
  const app = buildApp(config, handle.db);
  await app.ready();
  return {
    app,
    handle,
    config,
    // `languages` is seed data owned by migrations, so it is kept.
    reset: async () => {
      await handle.pool.query(
        'truncate table notifications, registration_payments, match_registrations, legal_document_translations, legal_documents, payment_instruction_translations, payment_instructions, match_translations, matches, users cascade',
      );
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
  } = {},
): Promise<{ id: string; token: string }> {
  const [row] = await ctx.handle.db
    .insert(users)
    .values({
      displayName: data.displayName ?? 'Test User',
      role: data.role ?? 'PLAYER',
      preferredLanguage: data.preferredLanguage ?? null,
      deviceLocale: data.deviceLocale ?? null,
    })
    .returning({ id: users.id });
  if (!row) throw new Error('user insert failed');
  return { id: row.id, token: await signToken(ctx.config, row.id) };
}

export function signToken(
  config: AppConfig,
  subject: string,
  options: { secret?: string; issuer?: string; audience?: string; expiresIn?: string } = {},
): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(subject)
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
