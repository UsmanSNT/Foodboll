import type { LanguageDto } from '@foodboll/contracts';
import { isLocaleCode } from '@foodboll/i18n';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { languages } from '../db/schema';

/** Enabled languages that the product also has a message catalog for. */
export async function listEnabledLanguages(db: Db): Promise<LanguageDto[]> {
  const rows = await db
    .select()
    .from(languages)
    .where(eq(languages.enabled, true))
    .orderBy(asc(languages.sortOrder), asc(languages.code));
  return rows.flatMap((row) =>
    isLocaleCode(row.code)
      ? [{ code: row.code, nativeName: row.nativeName, englishName: row.englishName }]
      : [],
  );
}
