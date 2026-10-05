import type {
  MatchDto,
  MatchInput,
  MatchSummaryDto,
  MatchTranslationsDto,
  Page,
} from '@foodboll/contracts';
import {
  isLocaleCode,
  LOCALE_CODES,
  pickLocalized,
  type LocaleCode,
  type LocalizedText,
  type LocalizedValue,
} from '@foodboll/i18n';
import { asc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { AuthUser } from '../context';
import type { Db } from '../db/client';
import { matches, matchTranslations } from '../db/schema';
import { forbidden, notFound } from '../errors';
import { assertLanguagesEnabled, assertSourceTranslation } from './translations';

type MatchRow = typeof matches.$inferSelect;
type TranslationRow = typeof matchTranslations.$inferSelect;

const TRANSLATED_FIELDS = [
  'description',
  'rules',
  'locationInstructions',
  'equipmentRequirements',
  'cancellationPolicy',
] as const;

function translationRows(matchId: string, input: MatchInput) {
  return LOCALE_CODES.flatMap((code) => {
    const t = input.translations[code];
    return t ? [{ matchId, languageCode: code, ...t }] : [];
  });
}

async function validate(db: Db, input: MatchInput): Promise<void> {
  assertSourceTranslation(input.translations, input.sourceLanguage);
  await assertLanguagesEnabled(db, [input.sourceLanguage, ...Object.keys(input.translations)]);
}

export async function createMatch(db: Db, organizerId: string, input: MatchInput): Promise<string> {
  await validate(db, input);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(matches)
      .values({
        organizerId,
        sourceLanguage: input.sourceLanguage,
        startsAt: new Date(input.startsAt),
        playersPerSide: input.playersPerSide,
        feeKrw: input.feeKrw,
      })
      .returning({ id: matches.id });
    if (!row) throw new Error('Match insert returned no row');
    await tx.insert(matchTranslations).values(translationRows(row.id, input));
    return row.id;
  });
}

/** Replaces the match and all of its translations. Only the organizer or an admin may do this. */
export async function replaceMatch(
  db: Db,
  actor: AuthUser,
  matchId: string,
  input: MatchInput,
): Promise<void> {
  await validate(db, input);
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(matches)
      .where(eq(matches.id, matchId))
      .for('update');
    if (!existing) throw notFound('MATCH_NOT_FOUND');
    if (actor.role !== 'ADMIN' && existing.organizerId !== actor.id) throw forbidden();
    await tx
      .update(matches)
      .set({
        sourceLanguage: input.sourceLanguage,
        startsAt: new Date(input.startsAt),
        playersPerSide: input.playersPerSide,
        feeKrw: input.feeKrw,
        updatedAt: sql`now()`,
      })
      .where(eq(matches.id, matchId));
    await tx.delete(matchTranslations).where(eq(matchTranslations.matchId, matchId));
    await tx.insert(matchTranslations).values(translationRows(matchId, input));
  });
}

async function loadTranslations(db: Db, matchIds: readonly string[]) {
  const byMatch = new Map<string, TranslationRow[]>();
  if (matchIds.length === 0) return byMatch;
  const rows = await db
    .select()
    .from(matchTranslations)
    .where(inArray(matchTranslations.matchId, [...matchIds]));
  for (const row of rows) {
    const list = byMatch.get(row.matchId) ?? [];
    list.push(row);
    byMatch.set(row.matchId, list);
  }
  return byMatch;
}

function textOf(
  translations: readonly TranslationRow[],
  field: 'title' | (typeof TRANSLATED_FIELDS)[number],
): LocalizedText {
  const text: Partial<Record<LocaleCode, string | null>> = {};
  for (const row of translations) {
    if (isLocaleCode(row.languageCode)) text[row.languageCode] = row[field];
  }
  return text;
}

function summary(row: MatchRow, translations: readonly TranslationRow[], locale: LocaleCode): MatchSummaryDto {
  const sourceLanguage = row.sourceLanguage as LocaleCode;
  const title: LocalizedValue | null = pickLocalized(textOf(translations, 'title'), locale, sourceLanguage);
  if (!title) throw new Error(`Match ${row.id} has no title in any language`);
  return {
    id: row.id,
    startsAt: row.startsAt.toISOString(),
    playersPerSide: row.playersPerSide,
    feeKrw: row.feeKrw,
    sourceLanguage,
    title,
  };
}

function toMatchDto(row: MatchRow, translations: readonly TranslationRow[], locale: LocaleCode): MatchDto {
  const source = row.sourceLanguage as LocaleCode;
  const field = (name: (typeof TRANSLATED_FIELDS)[number]) =>
    pickLocalized(textOf(translations, name), locale, source);
  return {
    ...summary(row, translations, locale),
    description: field('description'),
    rules: field('rules'),
    locationInstructions: field('locationInstructions'),
    equipmentRequirements: field('equipmentRequirements'),
    cancellationPolicy: field('cancellationPolicy'),
  };
}

/** Upcoming matches, soonest first. Two queries total regardless of page size. */
export async function listUpcomingMatches(
  db: Db,
  locale: LocaleCode,
  page: { limit: number; offset: number },
): Promise<Page<MatchSummaryDto>> {
  const rows = await db
    .select()
    .from(matches)
    .where(gte(matches.startsAt, sql`now()`))
    .orderBy(asc(matches.startsAt), asc(matches.id))
    .limit(page.limit)
    .offset(page.offset);
  const translations = await loadTranslations(db, rows.map((r) => r.id));
  return {
    items: rows.map((row) => summary(row, translations.get(row.id) ?? [], locale)),
    limit: page.limit,
    offset: page.offset,
  };
}

export async function getMatch(db: Db, id: string, locale: LocaleCode): Promise<MatchDto> {
  const [row] = await db.select().from(matches).where(eq(matches.id, id)).limit(1);
  if (!row) throw notFound('MATCH_NOT_FOUND');
  const translations = await loadTranslations(db, [id]);
  return toMatchDto(row, translations.get(id) ?? [], locale);
}

/** Raw per-language texts for editing; restricted to the organizer and admins. */
export async function getMatchTranslations(
  db: Db,
  actor: AuthUser,
  id: string,
): Promise<MatchTranslationsDto> {
  const [row] = await db.select().from(matches).where(eq(matches.id, id)).limit(1);
  if (!row) throw notFound('MATCH_NOT_FOUND');
  if (actor.role !== 'ADMIN' && row.organizerId !== actor.id) throw forbidden();
  const rows = (await loadTranslations(db, [id])).get(id) ?? [];
  const translations: MatchTranslationsDto['translations'] = Object.fromEntries(
    rows
      .filter((r) => isLocaleCode(r.languageCode))
      .map((r) => [
        r.languageCode,
        {
          title: r.title,
          description: r.description,
          rules: r.rules,
          locationInstructions: r.locationInstructions,
          equipmentRequirements: r.equipmentRequirements,
          cancellationPolicy: r.cancellationPolicy,
        },
      ]),
  );
  return { sourceLanguage: row.sourceLanguage as LocaleCode, translations };
}
