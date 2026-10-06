import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  /** HS256 secret shared with the (future) auth service that issues access tokens. */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ISSUER: z.string().default('foodboll'),
  JWT_AUDIENCE: z.string().default('foodboll-api'),
  /** Comma-separated list of allowed browser origins. Empty = no cross-origin access. */
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  /** The one price every participant pays, in KRW. Snapshotted onto each match when announced. */
  MATCH_FEE_KRW: z.coerce.number().int().min(0).max(1_000_000).default(10_000),
  /** Directory for payment receipt files. Must be persistent, private, and backed up. */
  RECEIPT_DIR: z.string().default('./data/receipts'),
  /** Per-client cap on receipt uploads (large bodies). */
  UPLOAD_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  /** Set when running behind a reverse proxy so client IPs (rate limiting) are correct. */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly host: string;
  readonly logLevel: string;
  readonly databaseUrl: string;
  readonly jwtSecret: string;
  readonly jwtIssuer: string;
  readonly jwtAudience: string;
  readonly corsOrigins: readonly string[];
  readonly matchFeeKrw: number;
  readonly receiptDir: string;
  readonly rateLimitPerMinute: number;
  readonly uploadRateLimitPerMinute: number;
  readonly trustProxy: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    jwtSecret: e.JWT_SECRET,
    jwtIssuer: e.JWT_ISSUER,
    jwtAudience: e.JWT_AUDIENCE,
    corsOrigins: e.CORS_ORIGINS,
    matchFeeKrw: e.MATCH_FEE_KRW,
    receiptDir: e.RECEIPT_DIR,
    rateLimitPerMinute: e.RATE_LIMIT_PER_MINUTE,
    uploadRateLimitPerMinute: e.UPLOAD_RATE_LIMIT_PER_MINUTE,
    trustProxy: e.TRUST_PROXY,
  };
}
