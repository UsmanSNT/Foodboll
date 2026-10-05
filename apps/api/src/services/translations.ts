import { AppError } from '../errors';
import type { Db } from '../db/client';
import { languages } from '../db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import type { LocaleCode } from '@foodboll/i18n';

/**
 * The text in the author's source language is mandatory: it is what every reader falls back to,
 * so no field can ever be empty for anyone.
 */
export function assertSourceTranslation(
  translations: Partial<Record<LocaleCode, unknown>>,
  sourceLanguage: LocaleCode,
): void {
  if (translations[sourceLanguage] === undefined) {
    throw new AppError('SOURCE_TRANSLATION_REQUIRED', 422);
  }
}

/** Every language written to must exist and be enabled. */
export async function assertLanguagesEnabled(db: Db, codes: readonly string[]): Promise<void> {
  const unique = [...new Set(codes)];
  if (unique.length === 0) return;
  const rows = await db
    .select({ code: languages.code })
    .from(languages)
    .where(and(eq(languages.enabled, true), inArray(languages.code, unique)));
  if (rows.length !== unique.length) throw new AppError('LANGUAGE_NOT_SUPPORTED', 422);
}
