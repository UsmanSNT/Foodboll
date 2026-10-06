import type { AuthTokenDto, TelegramLoginInput } from '@foodboll/contracts';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { SignJWT } from 'jose';
import type { AuthUser } from '../context';
import type { AppConfig } from '../config';
import type { Db } from '../db/client';
import { authSessions, telegramLoginReplays, userIdentities, users } from '../db/schema';
import { AppError } from '../errors';
import { findUserById, toAuthUser } from './users';

const invalidLogin = () => new AppError('TELEGRAM_LOGIN_INVALID', 401);

/** A signed login older than this is refused (the widget signs the moment the user approves). */
const TELEGRAM_LOGIN_MAX_AGE_SECONDS = 10 * 60;
const CLOCK_SKEW_SECONDS = 60;

/**
 * Verifies a Telegram Login Widget payload exactly as Telegram specifies: HMAC-SHA256 over the
 * sorted `key=value` lines, keyed with SHA-256(bot token). Authenticity proves the payload came
 * from Telegram for this bot; freshness plus the replay table stop reuse of a captured payload.
 */
export function verifyTelegramLogin(
  botToken: string,
  input: TelegramLoginInput,
  nowSeconds: number,
): boolean {
  const { hash, ...fields } = input;
  const dataCheckString = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
    .sort()
    .join('\n');
  const secret = createHash('sha256').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  const authDate = Number(input.auth_date);
  return (
    Number.isSafeInteger(authDate) &&
    nowSeconds - authDate <= TELEGRAM_LOGIN_MAX_AGE_SECONDS &&
    authDate - nowSeconds <= CLOCK_SKEW_SECONDS
  );
}

/** Display names come from an untrusted third party: normalize, strip control characters, bound. */
function displayNameFrom(...candidates: (string | undefined)[]): string {
  for (const candidate of candidates) {
    const cleaned = (candidate ?? '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
      .normalize('NFC')
      .trim()
      .slice(0, 100);
    if (cleaned) return cleaned;
  }
  return 'Player';
}

async function userForIdentity(
  db: Db,
  provider: 'TELEGRAM' | 'DEV',
  subject: string,
  name: string,
  role: AuthUser['role'] = 'PLAYER',
): Promise<AuthUser> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ userId: userIdentities.userId })
      .from(userIdentities)
      .where(and(eq(userIdentities.provider, provider), eq(userIdentities.subject, subject)));
    if (existing) {
      const user = await findUserById(tx, existing.userId);
      if (user) return user;
    }
    const [created] = await tx.insert(users).values({ displayName: name, role }).returning();
    if (!created) throw new Error('User insert returned no row');
    const claimed = await tx
      .insert(userIdentities)
      .values({ provider, subject, userId: created.id })
      .onConflictDoNothing()
      .returning({ userId: userIdentities.userId });
    if (claimed.length === 0) {
      // Lost a race with a concurrent first login: use the winner's user, discard ours.
      await tx.delete(users).where(eq(users.id, created.id));
      const [winner] = await tx
        .select({ userId: userIdentities.userId })
        .from(userIdentities)
        .where(and(eq(userIdentities.provider, provider), eq(userIdentities.subject, subject)));
      const user = winner ? await findUserById(tx, winner.userId) : null;
      if (!user) throw new Error('Identity vanished during login');
      return user;
    }
    return toAuthUser(created);
  });
}

export async function loginWithTelegram(
  db: Db,
  config: AppConfig,
  input: TelegramLoginInput,
  now: Date = new Date(),
): Promise<AuthUser> {
  if (!config.telegram) throw new AppError('NOT_FOUND', 404);
  if (!verifyTelegramLogin(config.telegram.botToken, input, Math.floor(now.getTime() / 1000))) {
    throw invalidLogin();
  }
  const telegramUserId = String(input.id);
  const inserted = await db
    .insert(telegramLoginReplays)
    .values({ telegramUserId, authDate: Number(input.auth_date) })
    .onConflictDoNothing()
    .returning({ id: telegramLoginReplays.telegramUserId });
  if (inserted.length === 0) throw invalidLogin();

  const fullName = [input.first_name, input.last_name].filter(Boolean).join(' ');
  return userForIdentity(db, 'TELEGRAM', telegramUserId, displayNameFrom(fullName, input.username));
}

/** Development convenience: sign in as a named user. Unavailable unless DEV_LOGIN is enabled. */
export async function devLogin(
  db: Db,
  config: AppConfig,
  input: { name: string; role: AuthUser['role'] },
): Promise<AuthUser> {
  if (!config.devLogin) throw new AppError('NOT_FOUND', 404);
  const user = await userForIdentity(db, 'DEV', input.name.toLowerCase(), input.name, input.role);
  if (user.role !== input.role) {
    await db.update(users).set({ role: input.role }).where(eq(users.id, user.id));
    return { ...user, role: input.role };
  }
  return user;
}

export async function issueSession(
  db: Db,
  config: AppConfig,
  user: AuthUser,
  now: Date = new Date(),
): Promise<{ accessToken: string; expiresAt: Date }> {
  const expiresAt = new Date(now.getTime() + config.sessionDays * 24 * 3600 * 1000);
  const [session] = await db
    .insert(authSessions)
    .values({ userId: user.id, expiresAt })
    .returning({ id: authSessions.id });
  if (!session) throw new Error('Session insert returned no row');
  return {
    accessToken: await signAccessToken(config, user.id, session.id, expiresAt, now),
    expiresAt,
  };
}

export function signAccessToken(
  config: AppConfig,
  userId: string,
  sessionId: string,
  expiresAt: Date,
  now: Date = new Date(),
): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setJti(sessionId)
    .setIssuer(config.jwtIssuer)
    .setAudience(config.jwtAudience)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(new TextEncoder().encode(config.jwtSecret));
}

/** The user behind a token, only while its session is live. Role and language come from the DB. */
export async function findSessionUser(
  db: Db,
  userId: string,
  sessionId: string,
  now: Date = new Date(),
): Promise<AuthUser | null> {
  const [session] = await db
    .select({ id: authSessions.id })
    .from(authSessions)
    .where(
      and(
        eq(authSessions.id, sessionId),
        eq(authSessions.userId, userId),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, now),
      ),
    );
  return session ? findUserById(db, userId) : null;
}

export async function revokeSession(
  db: Db,
  sessionId: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(authSessions)
    .set({ revokedAt: now })
    .where(and(eq(authSessions.id, sessionId), isNull(authSessions.revokedAt)));
}

export async function revokeAllSessions(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(authSessions)
    .set({ revokedAt: now })
    .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)));
}

export type { AuthTokenDto };
