import type { LegalDocumentDto, LegalDocumentInput, LegalDocumentType } from '@foodboll/contracts';
import {
  DEFAULT_LOCALE,
  isLocaleCode,
  LOCALE_CODES,
  pickLocalized,
  type LocaleCode,
} from '@foodboll/i18n';
import { desc, eq, max, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { legalDocuments, legalDocumentTranslations } from '../db/schema';
import { notFound } from '../errors';
import { assertLanguagesEnabled, assertSourceTranslation } from './translations';

/** Publishes a new immutable version. Returns the version number. */
export async function publishLegalDocument(
  db: Db,
  adminId: string,
  type: LegalDocumentType,
  input: LegalDocumentInput,
): Promise<number> {
  assertSourceTranslation(input.translations, DEFAULT_LOCALE);
  await assertLanguagesEnabled(db, Object.keys(input.translations));
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`legal:${type}`}))`);
    const [latest] = await tx
      .select({ version: max(legalDocuments.version) })
      .from(legalDocuments)
      .where(eq(legalDocuments.type, type));
    const version = (latest?.version ?? 0) + 1;
    const [row] = await tx
      .insert(legalDocuments)
      .values({ type, version, createdBy: adminId })
      .returning({ id: legalDocuments.id });
    if (!row) throw new Error('Legal document insert returned no row');
    await tx.insert(legalDocumentTranslations).values(
      LOCALE_CODES.flatMap((code) => {
        const t = input.translations[code];
        return t ? [{ documentId: row.id, languageCode: code, ...t }] : [];
      }),
    );
    return version;
  });
}

/**
 * Latest version of a document. A reader without a translation gets the Korean original with
 * `isFallback: true`; clients must tell the user, and must not treat it as translated consent.
 */
export async function getCurrentLegalDocument(
  db: Db,
  type: LegalDocumentType,
  locale: LocaleCode,
): Promise<LegalDocumentDto> {
  const [doc] = await db
    .select()
    .from(legalDocuments)
    .where(eq(legalDocuments.type, type))
    .orderBy(desc(legalDocuments.version))
    .limit(1);
  if (!doc) throw notFound('LEGAL_DOCUMENT_NOT_FOUND');
  const rows = await db
    .select()
    .from(legalDocumentTranslations)
    .where(eq(legalDocumentTranslations.documentId, doc.id));
  const field = (name: 'title' | 'body') => {
    const text: Partial<Record<LocaleCode, string>> = {};
    for (const r of rows) if (isLocaleCode(r.languageCode)) text[r.languageCode] = r[name];
    const picked = pickLocalized(text, locale, DEFAULT_LOCALE);
    if (!picked) throw new Error(`Legal document ${doc.id} has no ${name}`);
    return picked;
  };
  return {
    type: doc.type,
    version: doc.version,
    publishedAt: doc.publishedAt.toISOString(),
    title: field('title'),
    body: field('body'),
  };
}
