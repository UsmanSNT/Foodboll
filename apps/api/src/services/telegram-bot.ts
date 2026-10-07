import { matchLocale, translate, DEFAULT_LOCALE, type LocaleCode } from '@foodboll/i18n';
import { and, eq, sql } from 'drizzle-orm';
import { cancelPendingTelegramNotifications } from './notification-worker';
import { z } from 'zod';
import type { Db } from '../db/client';
import { userIdentities, users } from '../db/schema';
import type { TelegramClient } from '../integrations/telegram';

const messageSchema = z.object({
  message_id: z.number().int().optional(),
  /** Unix time Telegram received the message. */
  date: z.number().int().optional(),
  text: z.string().max(4096).optional(),
  from: z.object({ id: z.number().int(), language_code: z.string().max(35).optional() }).optional(),
  chat: z.object({ id: z.number().int(), type: z.string() }),
});

/** The slice of a Telegram Update the bot reads. Unknown fields are ignored on purpose. */
const updateSchema = z.object({
  message: messageSchema.optional(),
  channel_post: messageSchema.optional(),
});

export interface BankChannel {
  /** The one channel whose posts are bank notifications. */
  readonly chatId: string;
  readonly ingest: (input: {
    text: string;
    receivedAt: Date;
    externalId: string;
  }) => Promise<unknown>;
}

export interface BotDeps {
  readonly db: Db;
  readonly client: TelegramClient;
  readonly bankChannel?: BankChannel | null;
  readonly onError?: (error: unknown) => void;
}

/**
 * Reacts to messages people send the bot in a private chat:
 *  - /start: turns on Telegram notifications for the user whose Telegram id matches a login
 *  - /stop:  turns them off
 * A person who never logged in through the app is asked to do that first. A failed reply never
 * rejects (it must not make Telegram retry). A failing bank-channel `ingest` does reject, so the
 * webhook can answer non-2xx and Telegram redelivers the post.
 */
export async function handleTelegramUpdate(deps: BotDeps, update: unknown): Promise<void> {
  const parsed = updateSchema.safeParse(update);

  // Bank notifications arrive as posts in one private channel. Only `channel_post` from exactly
  // that channel counts: group messages (anyone can write) and edits are never trusted.
  const post = parsed.success ? parsed.data.channel_post : undefined;
  if (post) {
    const bank = deps.bankChannel;
    if (bank && post.chat.type === 'channel' && String(post.chat.id) === bank.chatId && post.text) {
      await bank.ingest({
        text: post.text,
        receivedAt: new Date((post.date ?? Math.floor(Date.now() / 1000)) * 1000),
        externalId: `${post.chat.id}:${post.message_id ?? post.date ?? 'x'}`,
      });
    }
    return;
  }

  const message = parsed.success ? parsed.data.message : undefined;
  if (!message?.from || message.chat.type !== 'private' || !message.text) return;

  const command = /^\/(start|stop)(?:@\w+)?(?:\s|$)/i.exec(message.text.trim())?.[1]?.toLowerCase();
  if (!command) return;

  const telegramId = String(message.from.id);
  const [row] = await deps.db
    .select({ userId: userIdentities.userId, preferredLanguage: users.preferredLanguage })
    .from(userIdentities)
    .innerJoin(users, eq(users.id, userIdentities.userId))
    .where(and(eq(userIdentities.provider, 'TELEGRAM'), eq(userIdentities.subject, telegramId)));

  const locale: LocaleCode =
    matchLocale(row?.preferredLanguage ?? '') ??
    matchLocale(message.from.language_code ?? '') ??
    DEFAULT_LOCALE;

  let reply: string;
  if (!row) {
    reply = translate(locale, 'telegram.loginFirst');
  } else if (command === 'start') {
    await deps.db
      .update(users)
      .set({ telegramStartedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(users.id, row.userId));
    reply = translate(locale, 'telegram.started');
  } else {
    await deps.db
      .update(users)
      .set({ telegramStartedAt: null, updatedAt: sql`now()` })
      .where(eq(users.id, row.userId));
    await cancelPendingTelegramNotifications(deps.db, row.userId);
    reply = translate(locale, 'telegram.stopped');
  }
  try {
    await deps.client.sendMessage(telegramId, reply);
  } catch (error) {
    deps.onError?.(error);
  }
}
