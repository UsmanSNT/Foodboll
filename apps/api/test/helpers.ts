import type { UserRole } from '@foodboll/contracts';
import type { LocaleCode } from '@foodboll/i18n';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { inject } from 'vitest';
import { buildApp } from '../src/app';
import type { AppConfig } from '../src/config';
import { createDb, type DbHandle } from '../src/db/client';
import { users } from '../src/db/schema';

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
  rateLimitPerMinute: 10_000,
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
        'truncate table notifications, legal_document_translations, legal_documents, payment_instruction_translations, payment_instructions, match_translations, matches, users cascade',
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
