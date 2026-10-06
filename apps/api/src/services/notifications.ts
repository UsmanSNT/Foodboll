import {
  NOTIFICATION_MESSAGE_KEYS,
  type NotificationDto,
  type NotificationPage,
  type NotificationType,
} from '@foodboll/contracts';
import {
  resolveLocale,
  translate,
  type LocaleCode,
  type MessageKey,
  type MessageParams,
} from '@foodboll/i18n';
import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AuthUser } from '../context';
import type { Db, DbOrTx } from '../db/client';
import { notifications, users } from '../db/schema';
import { notFound } from '../errors';

export interface EnqueueNotification {
  readonly userId: string;
  readonly type: NotificationType;
  /** Plain values (numbers, names) interpolated as-is. */
  readonly params?: MessageParams;
  /** Parameters that are themselves catalog messages, rendered in the reader's language. */
  readonly localizedParams?: Readonly<Record<string, MessageKey>>;
}

/** What is stored so a notification can be re-rendered later in any language. */
interface StoredParams {
  readonly values?: Record<string, string | number>;
  readonly keys?: Record<string, MessageKey>;
}

function renderText(type: NotificationType, locale: LocaleCode, stored: unknown) {
  const raw = (stored ?? {}) as StoredParams & Record<string, unknown>;
  // Tolerate rows written before params had this shape (a flat map of values).
  const values = raw.values ?? (raw.keys ? {} : (raw as Record<string, string | number>));
  const params: Record<string, string | number> = { ...values };
  for (const [name, key] of Object.entries(raw.keys ?? {})) params[name] = translate(locale, key);
  const keys = NOTIFICATION_MESSAGE_KEYS[type];
  return {
    title: translate(locale, keys.title, params),
    body: translate(locale, keys.body, params),
  };
}

/**
 * Queues a notification for a user. This is the only way domain code should message people, so
 * language selection and channel choice live in exactly one place.
 *
 * - IN_APP: always; it is the user's inbox and is rendered again in their current language.
 * - TELEGRAM: additionally, once the user pressed Start in the bot; delivered by the worker in
 *   the language the user had when the notification was created.
 *
 * Language: the user's saved choice, else the language their device reported, else Korean.
 * Organizers are never notified about individual payments; only the player concerned is.
 */
export async function enqueueNotification(
  db: DbOrTx,
  input: EnqueueNotification,
): Promise<string[]> {
  const [user] = await db
    .select({
      preferredLanguage: users.preferredLanguage,
      deviceLocale: users.deviceLocale,
      telegramStartedAt: users.telegramStartedAt,
    })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!user) throw notFound();

  const { locale } = resolveLocale({
    account: user.preferredLanguage,
    deviceLanguages: user.deviceLocale ? [user.deviceLocale] : [],
  });
  const stored: StoredParams = {
    values: { ...input.params } as Record<string, string | number>,
    keys: { ...input.localizedParams },
  };
  const { title, body } = renderText(input.type, locale, stored);
  const now = new Date();

  const base = {
    userId: input.userId,
    type: input.type,
    languageCode: locale,
    title,
    body,
    params: stored,
  };
  const rows = await db
    .insert(notifications)
    .values([
      { ...base, channel: 'IN_APP', status: 'SENT', sentAt: now },
      ...(user.telegramStartedAt ? [{ ...base, channel: 'TELEGRAM' }] : []),
    ])
    .returning({ id: notifications.id });
  return rows.map((row) => row.id);
}

/** The user's inbox, newest first, rendered in the language they use now. */
export async function listInbox(
  db: Db,
  user: AuthUser,
  locale: LocaleCode,
  page: { limit: number; offset: number },
): Promise<NotificationPage> {
  const inbox = and(eq(notifications.userId, user.id), eq(notifications.channel, 'IN_APP'));
  const [rows, [unread]] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(inbox)
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(page.limit)
      .offset(page.offset),
    db
      .select({ n: count() })
      .from(notifications)
      .where(and(inbox, isNull(notifications.readAt))),
  ]);
  const items: NotificationDto[] = rows.map((row) => {
    const type = row.type as NotificationType;
    return {
      id: row.id,
      type,
      ...renderText(type, locale, row.params),
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
    };
  });
  return { items, limit: page.limit, offset: page.offset, unread: unread?.n ?? 0 };
}

export async function markInboxRead(
  db: Db,
  user: AuthUser,
  selection: { all: true } | { ids: string[] },
): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(
      and(
        eq(notifications.userId, user.id),
        eq(notifications.channel, 'IN_APP'),
        isNull(notifications.readAt),
        'ids' in selection ? inArray(notifications.id, selection.ids) : undefined,
      ),
    );
}
