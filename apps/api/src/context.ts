import type { UserRole } from '@foodboll/contracts';
import {
  DEFAULT_LOCALE,
  detectLocale,
  isLocaleCode,
  parseAcceptLanguage,
  type LocaleCode,
} from '@foodboll/i18n';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { jwtVerify } from 'jose';
import type { AppConfig } from './config';
import type { Db } from './db/client';
import { forbidden, unauthenticated } from './errors';
import { findSessionUser } from './services/auth';

export interface AuthUser {
  readonly id: string;
  readonly role: UserRole;
  readonly displayName: string;
  readonly preferredLanguage: LocaleCode | null;
  readonly homeRegionId: string | null;
  readonly depositorName: string | null;
}

export interface RequestContext {
  readonly user: AuthUser | null;
  /** The session the request's token belongs to (for logout). */
  readonly sessionId: string | null;
  /** Language responses are rendered in. */
  readonly locale: LocaleCode;
}

declare module 'fastify' {
  interface FastifyRequest {
    ctx: RequestContext;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createContextHook(config: AppConfig, db: Db) {
  const key = new TextEncoder().encode(config.jwtSecret);

  async function authenticate(
    header: string | undefined,
  ): Promise<{ user: AuthUser; sessionId: string } | null> {
    if (header === undefined) return null;
    const match = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(header);
    if (!match?.[1]) throw unauthenticated();
    let subject: string | undefined;
    let sessionId: string | undefined;
    try {
      const { payload } = await jwtVerify(match[1], key, {
        algorithms: ['HS256'],
        issuer: config.jwtIssuer,
        audience: config.jwtAudience,
      });
      subject = payload.sub;
      sessionId = payload.jti;
    } catch {
      throw unauthenticated();
    }
    if (!subject || !UUID.test(subject) || !sessionId || !UUID.test(sessionId)) {
      throw unauthenticated();
    }
    // A token is only good while its session is live; role and language come from the database,
    // not the token, so revocation and changes apply immediately.
    const user = await findSessionUser(db, subject, sessionId);
    if (!user) throw unauthenticated();
    return { user, sessionId };
  }

  /**
   * Language precedence for a response:
   * explicit `?lang=` > the signed-in user's saved language > Accept-Language > Korean.
   */
  function negotiateLocale(request: FastifyRequest, user: AuthUser | null): LocaleCode {
    const query = request.query as { lang?: unknown } | undefined;
    if (isLocaleCode(query?.lang)) return query.lang;
    if (user?.preferredLanguage) return user.preferredLanguage;
    const header = request.headers['accept-language'];
    return (
      detectLocale(parseAcceptLanguage(typeof header === 'string' ? header : undefined)) ??
      DEFAULT_LOCALE
    );
  }

  return async function contextHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // Machine-to-machine endpoints (Telegram, bank forwarder) authenticate with their own secret
    // in the Authorization header; it is not a user token and must not be parsed as one.
    const machine = request.url.startsWith('/v1/integrations/');
    const auth = machine ? null : await authenticate(request.headers.authorization);
    const user = auth?.user ?? null;
    const locale = negotiateLocale(request, user);
    request.ctx = { user, sessionId: auth?.sessionId ?? null, locale };
    void reply.header('Content-Language', locale);
    void reply.header('Vary', 'Accept-Language, Authorization');
  };
}

export function requireUser(request: FastifyRequest): AuthUser {
  if (!request.ctx.user) throw unauthenticated();
  return request.ctx.user;
}

export function requireRole(request: FastifyRequest, ...roles: readonly UserRole[]): AuthUser {
  const user = requireUser(request);
  if (!roles.includes(user.role)) throw forbidden();
  return user;
}
