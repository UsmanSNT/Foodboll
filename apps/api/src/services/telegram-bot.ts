import { matchLocale, translate, DEFAULT_LOCALE, type LocaleCode } from '@foodboll/i18n';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { userIdentities, users } from '../db/schema';
import type { TelegramClient } from '../integrations/telegram';

/** The slice of a Telegram Update the bot reads. Unknown fields are ignored on purpose. */
const updateSchema = z.object({
  message: z
    .object({
      text: z.string().max(4096).optional(),
      from: z
        .object({ id: z.number().int(), language_code: z.string().max(35).optional() })
        .optional(),
      chat: z.object({ id: z.number().int(), type: z.string() }),
    })
    .optional(),
});

export interface BotDeps {
  readonly db: Db;
  readonly client: TelegramClient;
  readonly onError?: (error: unknown) => void;
}

/**
 * Reacts to messages people send the bot in a private chat:
 *  - /start: turns on Telegram notifications for the user whose Telegram id matches a login
 *  - /stop:  turns them off
 * A person who never logged in through the app is asked to do that first. Always resolves; a
 * failed reply must never make Telegram retry the webhook.
 */
export async function handleTelegramUpdate(deps: BotDeps, update: unknown): Promise<void> {
  const parsed = updateSchema.safeParse(update);
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
    reply = translate(locale, 'telegram.stopped');
  }
  try {
    await deps.client.sendMessage(telegramId, reply);
  } catch (error) {
    deps.onError?.(error);
  }
}
