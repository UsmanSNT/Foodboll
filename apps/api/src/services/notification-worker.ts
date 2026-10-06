import { and, asc, eq, isNull, lte, or } from 'drizzle-orm';
import type { Db } from '../db/client';
import { notifications, userIdentities, users } from '../db/schema';
import { TelegramApiError, type TelegramClient } from '../integrations/telegram';

const MAX_ATTEMPTS = 6;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

export interface DeliveryResult {
  readonly sent: number;
  readonly retrying: number;
  readonly failed: number;
}

/**
 * Sends queued Telegram notifications. Rows are claimed with FOR UPDATE SKIP LOCKED, so several
 * workers (or API instances) can run at once without sending anything twice.
 *
 *  - delivered            -> SENT
 *  - user unreachable     -> FAILED, and their Telegram flag is cleared (they blocked the bot)
 *  - rate limited / error -> retried later with exponential backoff, FAILED after MAX_ATTEMPTS
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

  await db.transaction(async (tx) => {
    const due = await tx
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

    for (const item of due) {
      try {
        await client.sendMessage(item.chatId, `${item.title}\n${item.body}`);
        await tx
          .update(notifications)
          .set({ status: 'SENT', sentAt: now, attempts: item.attempts + 1, lastError: null })
          .where(eq(notifications.id, item.id));
        sent++;
      } catch (error) {
        const apiError = error instanceof TelegramApiError ? error : null;
        const attempts = item.attempts + 1;
        const description = apiError?.description ?? 'unknown error';
        if (apiError?.isPermanent) {
          await tx
            .update(notifications)
            .set({ status: 'FAILED', attempts, lastError: description })
            .where(eq(notifications.id, item.id));
          await tx.update(users).set({ telegramStartedAt: null }).where(eq(users.id, item.userId));
          failed++;
        } else if (attempts >= MAX_ATTEMPTS) {
          await tx
            .update(notifications)
            .set({ status: 'FAILED', attempts, lastError: description })
            .where(eq(notifications.id, item.id));
          failed++;
        } else {
          const backoffMs = apiError?.retryAfterSeconds
            ? apiError.retryAfterSeconds * 1000
            : Math.min(30_000 * 2 ** (attempts - 1), MAX_BACKOFF_MS);
          await tx
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
    }
  });
  return { sent, retrying, failed };
}

export interface WorkerHandle {
  stop(): void;
}

/** Polls for due notifications. Overlapping runs are skipped; errors are reported, never thrown. */
export function startNotificationWorker(
  db: Db,
  client: TelegramClient,
  options: { intervalMs?: number; onError: (error: unknown) => void },
): WorkerHandle {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    deliverTelegramNotifications(db, client)
      .catch(options.onError)
      .finally(() => {
        running = false;
      });
  }, options.intervalMs ?? 5_000);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
