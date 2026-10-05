import {
  NOTIFICATION_MESSAGE_KEYS,
  type NotificationChannel,
  type NotificationType,
} from '@foodboll/contracts';
import { resolveLocale, translate, type MessageParams } from '@foodboll/i18n';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { notifications, users } from '../db/schema';
import { notFound } from '../errors';

export interface EnqueueNotification {
  readonly userId: string;
  readonly type: NotificationType;
  readonly channels: readonly NotificationChannel[];
  readonly params?: MessageParams;
}

/**
 * Renders a notification in the recipient's language and queues it for delivery. This is the only
 * way domain code should message users, so language selection lives in exactly one place.
 *
 * Language: the user's saved choice, else the language their device reported, else Korean.
 */
export async function enqueueNotification(db: Db, input: EnqueueNotification): Promise<string[]> {
  if (input.channels.length === 0) return [];
  const [user] = await db
    .select({ preferredLanguage: users.preferredLanguage, deviceLocale: users.deviceLocale })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!user) throw notFound();

  const { locale } = resolveLocale({
    account: user.preferredLanguage,
    deviceLanguages: user.deviceLocale ? [user.deviceLocale] : [],
  });
  const keys = NOTIFICATION_MESSAGE_KEYS[input.type];
  const title = translate(locale, keys.title, input.params);
  const body = translate(locale, keys.body, input.params);

  const rows = await db
    .insert(notifications)
    .values(
      input.channels.map((channel) => ({
        userId: input.userId,
        type: input.type,
        channel,
        languageCode: locale,
        title,
        body,
        params: { ...input.params },
      })),
    )
    .returning({ id: notifications.id });
  return rows.map((row) => row.id);
}
