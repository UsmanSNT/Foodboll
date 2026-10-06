import type { AdminUserDto, MeDto, Page, UpdateLanguageInput, UserRole } from '@foodboll/contracts';
import { isLocaleCode, type LocaleCode } from '@foodboll/i18n';
import { desc, eq, isNull, sql } from 'drizzle-orm';
import type { AuthUser } from '../context';
import type { Db, DbOrTx } from '../db/client';
import { users } from '../db/schema';
import { loadRegions } from './regions';
import { assertLanguagesEnabled } from './translations';

type UserRow = typeof users.$inferSelect;

export const toAuthUser = (row: UserRow): AuthUser => ({
  id: row.id,
  role: row.role as UserRole,
  displayName: row.displayName,
  preferredLanguage: isLocaleCode(row.preferredLanguage) ? row.preferredLanguage : null,
  homeRegionId: row.homeRegionId,
});

export async function findUserById(db: DbOrTx, id: string): Promise<AuthUser | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ? toAuthUser(row) : null;
}

/** The signed-in user's own view of their account, with their region in the response language. */
export async function buildMe(db: Db, user: AuthUser, locale: LocaleCode): Promise<MeDto> {
  const homeRegion = user.homeRegionId
    ? ((await loadRegions(db, [user.homeRegionId], locale)).get(user.homeRegionId) ?? null)
    : null;
  return {
    id: user.id,
    displayName: user.displayName,
    role: user.role,
    preferredLanguage: user.preferredLanguage,
    effectiveLanguage: locale,
    homeRegion,
  };
}

/**
 * Saves the user's explicit language choice and/or the language their device reports. Only the
 * former changes what the user sees; the latter is support context for admins.
 */
export async function updateUserLanguage(
  db: Db,
  userId: string,
  input: UpdateLanguageInput,
): Promise<AuthUser> {
  if (input.preferredLanguage !== undefined) {
    await assertLanguagesEnabled(db, [input.preferredLanguage]);
  }
  const [row] = await db
    .update(users)
    .set({
      ...(input.preferredLanguage !== undefined && { preferredLanguage: input.preferredLanguage }),
      ...(input.deviceLocale !== undefined && { deviceLocale: input.deviceLocale }),
      updatedAt: sql`now()`,
    })
    .where(eq(users.id, userId))
    .returning();
  if (!row) throw new Error('User disappeared during update');
  return toAuthUser(row);
}

export type LanguageFilter = LocaleCode | 'none';

export async function listUsersForAdmin(
  db: Db,
  params: { limit: number; offset: number; language?: LanguageFilter | undefined },
): Promise<Page<AdminUserDto>> {
  const where =
    params.language === undefined
      ? undefined
      : params.language === 'none'
        ? isNull(users.preferredLanguage)
        : eq(users.preferredLanguage, params.language);
  const rows = await db
    .select()
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(params.limit)
    .offset(params.offset);
  return {
    items: rows.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      role: row.role as UserRole,
      preferredLanguage: isLocaleCode(row.preferredLanguage) ? row.preferredLanguage : null,
      deviceLocale: row.deviceLocale,
      createdAt: row.createdAt.toISOString(),
    })),
    limit: params.limit,
    offset: params.offset,
  };
}
