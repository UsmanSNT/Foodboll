import { errorMessageKey, type ApiErrorBody, type ErrorCode } from '@foodboll/contracts';
import { DEFAULT_LOCALE, detectLocale, parseAcceptLanguage, translate } from '@foodboll/i18n';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import type { AppConfig } from './config';
import { createContextHook } from './context';
import type { Db } from './db/client';
import { AppError, type ErrorDetail } from './errors';
import { registerRoutes } from './routes';
import { registerAuthRoutes } from './routes/auth';
import { registerBankRoutes } from './routes/bank';
import { createTelegramClient, type TelegramClient } from './integrations/telegram';
import { LocalReceiptStorage, type ReceiptStorage } from './storage';

function localeForError(request: FastifyRequest) {
  if (request.ctx) return request.ctx.locale;
  const header = request.headers['accept-language'];
  return (
    detectLocale(parseAcceptLanguage(typeof header === 'string' ? header : undefined)) ??
    DEFAULT_LOCALE
  );
}

/**
 * Errors are logged without anything that embeds request data. Drizzle's DrizzleQueryError carries
 * the SQL and every bound parameter (bank messages, names) in `query`, `params`, its message and
 * its stack header, and pg errors carry `detail`/`where` with row values. Only the type, code,
 * the first line of the message (cut at "Failed query:") and the stack frames are kept.
 */
export function serializeError(error: unknown): {
  type: string;
  message: string;
  stack: string;
  [key: string]: unknown;
} {
  if (!(error instanceof Error)) return { type: typeof error, message: '', stack: '' };
  const cause = error.cause instanceof Error ? error.cause : undefined;
  const code =
    (error as { code?: unknown }).code ?? (cause as { code?: unknown } | undefined)?.code;
  const isQuery = error.message.startsWith('Failed query:');
  const message = isQuery ? 'Failed query' : (error.message.split('\n')[0] ?? '');
  const frames = (error.stack ?? '')
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .join('\n');
  return {
    type: error.name,
    ...(typeof code === 'string' && { code }),
    message,
    stack: `${error.name}: ${message}\n${frames}`,
  };
}

/** Fastify's typings lack the hop-count form, so it is expressed as a function. */
function fastifyTrustProxy(
  value: AppConfig['trustProxy'],
): boolean | string[] | ((address: string, hop: number) => boolean) {
  if (typeof value === 'number') return (_address, hop) => hop < value;
  return typeof value === 'boolean' ? value : [...value];
}

export function buildApp(
  config: AppConfig,
  db: Db,
  deps: {
    storage?: ReceiptStorage;
    telegram?: TelegramClient | null;
    /** Where log lines go instead of stdout (tests). */
    logStream?: { write(line: string): void };
  } = {},
): FastifyInstance {
  const storage = deps.storage ?? new LocalReceiptStorage(config.receiptDir);
  const telegram =
    deps.telegram !== undefined
      ? deps.telegram
      : config.telegram
        ? createTelegramClient({ token: config.telegram.botToken })
        : null;
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      serializers: { err: serializeError },
      ...(deps.logStream && { stream: deps.logStream }),
    },
    trustProxy: fastifyTrustProxy(config.trustProxy),
    bodyLimit: 1_048_576,
    // Reject `__proto__` / `constructor` keys in JSON bodies instead of silently accepting them.
    onProtoPoisoning: 'error',
    onConstructorPoisoning: 'error',
  });

  app.decorateRequest('ctx', null as never);

  app.register(helmet);
  app.register(cors, {
    origin: config.corsOrigins.length > 0 ? [...config.corsOrigins] : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['Content-Language', 'Location'],
  });
  app.register(rateLimit, { max: config.rateLimitPerMinute, timeWindow: '1 minute' });

  app.addHook('onRequest', createContextHook(config, db));
  // Registered as a plugin so routes load AFTER the rate-limit plugin, which attaches to routes
  // through an `onRoute` hook and would silently skip any route defined before it.
  app.register(async (instance) => {
    registerAuthRoutes(instance, { db, config, telegram });
    registerBankRoutes(instance, db, config);
    registerRoutes(instance, db, storage, {
      uploadsPerMinute: config.uploadRateLimitPerMinute,
      matchFeeKrw: config.matchFeeKrw,
    });
  });

  const send = (
    request: FastifyRequest,
    code: ErrorCode,
    details?: readonly ErrorDetail[],
  ): ApiErrorBody => ({
    error: {
      code,
      message: translate(localeForError(request), errorMessageKey(code)),
      ...(details && { details }),
    },
  });

  app.setNotFoundHandler((request, reply) => reply.status(404).send(send(request, 'NOT_FOUND')));

  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send(send(request, error.code, error.details));
    }
    if (error instanceof ZodError) {
      // Report where and why, never the submitted values.
      const details = error.issues.map((issue) => ({
        path: issue.path.join('.'),
        issue: issue.code,
      }));
      return reply.status(400).send(send(request, 'VALIDATION_FAILED', details));
    }
    const statusCode = 'statusCode' in error ? error.statusCode : undefined;
    if (statusCode === 429) return reply.status(429).send(send(request, 'RATE_LIMITED'));
    if (statusCode === 413) return reply.status(413).send(send(request, 'PAYLOAD_TOO_LARGE'));
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      // Malformed JSON, oversized body, unsupported media type, etc.
      return reply.status(statusCode).send(send(request, 'VALIDATION_FAILED'));
    }
    request.log.error({ err: error }, 'Unhandled error');
    return reply.status(500).send(send(request, 'INTERNAL_ERROR'));
  });

  return app;
}
