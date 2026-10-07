import { and, asc, eq, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '../db/client';
import { notifications, userIdentities, users } from '../db/schema';
import { TelegramApiError, type TelegramClient } from '../integrations/telegram';

const MAX_ATTEMPTS = 6;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

export interface DeliveryResult {
  readonly sent: number;
  readonly retrying: number;
  readonly failed: number;
}

/** How long a claimed notification is reserved for the worker that claimed it. */
const LEASE_MS = 5 * 60 * 1000;

const OPTED_OUT_NOTE = 'telegram notifications off';

/**
 * Drops queued Telegram notifications of people who turned the bot off (/stop), so a message
 * written before they opted out is never delivered afterwards. Without `userId` it covers everyone.
 */
export async function cancelPendingTelegramNotifications(
  db: DbOrTx,
  userId?: string,
): Promise<void> {
  const optedOut = sql`not exists (
    select 1 from users u where u.id = ${notifications.userId} and u.telegram_started_at is not null)`;
  await db
    .update(notifications)
    .set({ status: 'FAILED', lastError: OPTED_OUT_NOTE })
    .where(
      and(
        eq(notifications.channel, 'TELEGRAM'),
        eq(notifications.status, 'PENDING'),
        userId ? eq(notifications.userId, userId) : undefined,
        optedOut,
      ),
    );
}

/**
 * Sends queued Telegram notifications with at-least-once delivery.
 *
 *  1. Opted-out users' pending rows are cancelled.
 *  2. Due rows are claimed in a short transaction (FOR UPDATE SKIP LOCKED) and leased by moving
 *     next_attempt_at LEASE_MS ahead, so several workers or API instances never send the same row.
 *  3. Messages are sent outside any transaction (no connection is held during HTTP calls) and each
 *     result is recorded with its own update:
 *       delivered            -> SENT
 *       user unreachable     -> FAILED, and their Telegram flag is cleared (they blocked the bot)
 *       rate limited / error -> retried later with exponential backoff, FAILED after MAX_ATTEMPTS
 *
 * If the process dies between sending and recording, the row becomes due again when its lease
 * expires and is sent once more: at most the messages in flight are repeated, never a whole batch.
 */
export async function deliverTelegramNotifications(
  db: Db,
  client: TelegramClient,
  now: Date = new Date(),
  batchSize = 20,
): Promise<DeliveryResult> {
  let sent = 0;
  let retrying = 0;
  let failed = 0;

  await cancelPendingTelegramNotifications(db);

  const due = await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: notifications.id,
        userId: notifications.userId,
        title: notifications.title,
        body: notifications.body,
        attempts: notifications.attempts,
        chatId: userIdentities.subject,
      })
      .from(notifications)
      .innerJoin(
        userIdentities,
        and(
          eq(userIdentities.userId, notifications.userId),
          eq(userIdentities.provider, 'TELEGRAM'),
        ),
      )
      .innerJoin(users, and(eq(users.id, notifications.userId), isNotNull(users.telegramStartedAt)))
      .where(
        and(
          eq(notifications.channel, 'TELEGRAM'),
          eq(notifications.status, 'PENDING'),
          or(isNull(notifications.nextAttemptAt), lte(notifications.nextAttemptAt, now)),
        ),
      )
      .orderBy(asc(notifications.createdAt))
      .limit(batchSize)
      .for('update', { of: notifications, skipLocked: true });
    if (rows.length > 0) {
      await tx
        .update(notifications)
        .set({ nextAttemptAt: new Date(now.getTime() + LEASE_MS) })
        .where(
          inArray(
            notifications.id,
            rows.map((row) => row.id),
          ),
        );
    }
    return rows;
  });

  for (const item of due) {
    let failure: unknown = null;
    try {
      await client.sendMessage(item.chatId, `${item.title}\n${item.body}`);
    } catch (error) {
      failure = error;
    }
    const attempts = item.attempts + 1;
    if (failure === null) {
      await db
        .update(notifications)
        .set({ status: 'SENT', sentAt: now, attempts, lastError: null, nextAttemptAt: null })
        .where(eq(notifications.id, item.id));
      sent++;
      continue;
    }
    const apiError = failure instanceof TelegramApiError ? failure : null;
    const description = apiError?.description ?? 'unknown error';
    if (apiError?.isPermanent) {
      await db
        .update(notifications)
        .set({ status: 'FAILED', attempts, lastError: description, nextAttemptAt: null })
        .where(eq(notifications.id, item.id));
      await db.update(users).set({ telegramStartedAt: null }).where(eq(users.id, item.userId));
      failed++;
    } else if (attempts >= MAX_ATTEMPTS) {
      await db
        .update(notifications)
        .set({ status: 'FAILED', attempts, lastError: description, nextAttemptAt: null })
        .where(eq(notifications.id, item.id));
      failed++;
    } else {
      const backoffMs = apiError?.retryAfterSeconds
        ? apiError.retryAfterSeconds * 1000
        : Math.min(30_000 * 2 ** (attempts - 1), MAX_BACKOFF_MS);
      await db
        .update(notifications)
        .set({
          attempts,
          lastError: description,
          nextAttemptAt: new Date(now.getTime() + backoffMs),
        })
        .where(eq(notifications.id, item.id));
      retrying++;
    }
  }
  return { sent, retrying, failed };
}

export interface WorkerHandle {
  /** Stops polling and resolves once a delivery run in flight has recorded its results. */
  stop(): Promise<void>;
}

/** Polls for due notifications. Overlapping runs are skipped; errors are reported, never thrown. */
export function startNotificationWorker(
  db: Db,
  client: TelegramClient,
  options: { intervalMs?: number; onError: (error: unknown) => void },
): WorkerHandle {
  let inFlight: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = deliverTelegramNotifications(db, client)
      .then(() => undefined, options.onError)
      .finally(() => {
        inFlight = null;
      });
  }, options.intervalMs ?? 5_000);
  timer.unref();
  return {
    stop: async () => {
      clearInterval(timer);
      await inFlight;
    },
  };
}
