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
  /** Per-client cap on sign-in attempts. */
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),
  SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Shared secret the phone's SMS-forwarding app sends with each bank notification. */
  BANK_WEBHOOK_SECRET: z
    .string()
    .min(32, 'BANK_WEBHOOK_SECRET must be at least 32 characters')
    .optional(),
  /** Comma-separated sender numbers/names accepted by the webhook (empty = accept any). */
  BANK_SMS_SENDERS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  /** Private Telegram channel where the bank's messages are forwarded (negative id for channels). */
  TELEGRAM_BANK_CHAT_ID: z
    .string()
    .regex(/^-?\d{1,20}$/)
    .optional(),
  /** Safety valve: at most this many automatic confirmations per 10 minutes, then humans review. */
  BANK_AUTO_CONFIRM_LIMIT_PER_10_MIN: z.coerce.number().int().min(1).default(30),
  /** Messages older than this are never confirmed automatically (guards against replays). */
  BANK_MESSAGE_MAX_AGE_HOURS: z.coerce.number().int().min(1).max(168).default(36),
  /** Local development only: enables POST /v1/auth/dev-login. Refused in production. */
  DEV_LOGIN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /** Telegram bot (login widget verification, notifications, bank-message channel). */
  TELEGRAM_BOT_TOKEN: z.string().min(20).optional(),
  TELEGRAM_BOT_USERNAME: z
    .string()
    .regex(/^[A-Za-z0-9_]{5,32}$/)
    .optional(),
  /** Secret Telegram echoes in X-Telegram-Bot-Api-Secret-Token on every webhook call. */
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .regex(/^[A-Za-z0-9_-]{16,256}$/)
    .optional(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  /** Set when running behind a reverse proxy so client IPs (rate limiting) are correct. */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export interface TelegramConfig {
  readonly botToken: string;
  readonly botUsername: string;
  readonly webhookSecret: string;
}

export interface BankConfig {
  /** Null disables the HTTP webhook (the Telegram channel may still be used). */
  readonly webhookSecret: string | null;
  readonly allowedSenders: readonly string[];
  readonly telegramChatId: string | null;
  readonly autoConfirmLimitPer10Min: number;
  readonly maxMessageAgeHours: number;
}

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
  readonly loginRateLimitPerMinute: number;
  readonly sessionDays: number;
  readonly devLogin: boolean;
  /** Null unless token, username and webhook secret are all configured. */
  readonly telegram: TelegramConfig | null;
  readonly bank: BankConfig;
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
  if (e.NODE_ENV === 'production' && e.DEV_LOGIN) {
    throw new Error(
      'Invalid environment configuration: DEV_LOGIN must not be enabled in production',
    );
  }
  const telegramParts = [e.TELEGRAM_BOT_TOKEN, e.TELEGRAM_BOT_USERNAME, e.TELEGRAM_WEBHOOK_SECRET];
  if (telegramParts.some(Boolean) && !telegramParts.every(Boolean)) {
    throw new Error(
      'Invalid environment configuration: set TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET together',
    );
  }
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
    loginRateLimitPerMinute: e.LOGIN_RATE_LIMIT_PER_MINUTE,
    sessionDays: e.SESSION_DAYS,
    devLogin: e.DEV_LOGIN,
    telegram:
      e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_BOT_USERNAME && e.TELEGRAM_WEBHOOK_SECRET
        ? {
            botToken: e.TELEGRAM_BOT_TOKEN,
            botUsername: e.TELEGRAM_BOT_USERNAME,
            webhookSecret: e.TELEGRAM_WEBHOOK_SECRET,
          }
        : null,
    bank: {
      webhookSecret: e.BANK_WEBHOOK_SECRET ?? null,
      allowedSenders: e.BANK_SMS_SENDERS,
      telegramChatId: e.TELEGRAM_BANK_CHAT_ID ?? null,
      autoConfirmLimitPer10Min: e.BANK_AUTO_CONFIRM_LIMIT_PER_10_MIN,
      maxMessageAgeHours: e.BANK_MESSAGE_MAX_AGE_HOURS,
    },
    matchFeeKrw: e.MATCH_FEE_KRW,
    receiptDir: e.RECEIPT_DIR,
    rateLimitPerMinute: e.RATE_LIMIT_PER_MINUTE,
    uploadRateLimitPerMinute: e.UPLOAD_RATE_LIMIT_PER_MINUTE,
    trustProxy: e.TRUST_PROXY,
  };
}
