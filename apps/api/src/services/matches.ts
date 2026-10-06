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
} from '@foodboll/i18n';
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { AuthUser } from '../context';
import type { Db, DbOrTx } from '../db/client';
import { matches, matchRegistrations, matchTranslations } from '../db/schema';
import { AppError, forbidden, notFound } from '../errors';
import { assertCanPublishIn } from './organizers';
import { findRegionByCode, loadRegions, regionScopeIds } from './regions';
import { loadSeatCounts, loadViewerRegistrations } from './seats';
import { assertLanguagesEnabled, assertSourceTranslation } from './translations';

type MatchRow = typeof matches.$inferSelect;
type TranslationRow = typeof matchTranslations.$inferSelect;

type TranslatedField =
  'description' | 'rules' | 'locationInstructions' | 'equipmentRequirements' | 'cancellationPolicy';

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

const invalidField = (path: string, issue: string) =>
  new AppError('VALIDATION_FAILED', 400, [{ path, issue }]);

/**
 * Announces a match. `feeKrw` is decided by the platform (one price for everyone), not by the
 * organizer, and is snapshotted onto the match so later price changes never alter existing ones.
 */
export async function createMatch(
  db: Db,
  actor: AuthUser,
  input: MatchInput,
  feeKrw: number,
  now: Date = new Date(),
): Promise<string> {
  await validate(db, input);
  if (new Date(input.startsAt) <= now) throw invalidField('startsAt', 'too_small');
  return db.transaction(async (tx) => {
    const region = await findRegionByCode(tx, input.regionCode);
    await assertCanPublishIn(tx, actor, region.id);
    const [row] = await tx
      .insert(matches)
      .values({
        organizerId: actor.id,
        regionId: region.id,
        sourceLanguage: input.sourceLanguage,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        venueName: input.venueName,
        venueAddress: input.venueAddress,
        playersPerSide: input.playersPerSide,
        maxPlayers: input.maxPlayers ?? input.playersPerSide * 2,
        feeKrw,
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
  now: Date = new Date(),
): Promise<void> {
  await validate(db, input);
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(matches).where(eq(matches.id, matchId)).for('update');
    if (!existing) throw notFound('MATCH_NOT_FOUND');
    if (actor.role !== 'ADMIN' && existing.organizerId !== actor.id) throw forbidden();
    if (existing.startsAt <= now) throw new AppError('MATCH_STARTED', 409);
    const region = await findRegionByCode(tx, input.regionCode);
    // An organizer may not move a match into a region they are not responsible for.
    await assertCanPublishIn(tx, actor, region.id);

    // Omitting maxPlayers keeps the current capacity; lowering it below the people already
    // holding a seat would silently over-book the match.
    const maxPlayers = input.maxPlayers ?? Math.max(existing.maxPlayers, input.playersPerSide * 2);
    const [{ taken } = { taken: 0 }] = await tx
      .select({ taken: sql<number>`count(*)::int` })
      .from(matchRegistrations)
      .where(
        and(
          eq(matchRegistrations.matchId, matchId),
          inArray(matchRegistrations.status, ['APPLIED', 'CONFIRMED']),
        ),
      );
    if (maxPlayers < taken) throw new AppError('CAPACITY_BELOW_REGISTRATIONS', 409);

    await tx
      .update(matches)
      .set({
        regionId: region.id,
        sourceLanguage: input.sourceLanguage,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        venueName: input.venueName,
        venueAddress: input.venueAddress,
        playersPerSide: input.playersPerSide,
        maxPlayers,
        updatedAt: sql`now()`,
      })
      .where(eq(matches.id, matchId));
    await tx.delete(matchTranslations).where(eq(matchTranslations.matchId, matchId));
    await tx.insert(matchTranslations).values(translationRows(matchId, input));
  });
}

async function loadTranslations(db: DbOrTx, matchIds: readonly string[]) {
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
  field: 'title' | TranslatedField,
): LocalizedText {
  const text: Partial<Record<LocaleCode, string | null>> = {};
  for (const row of translations) {
    if (isLocaleCode(row.languageCode)) text[row.languageCode] = row[field];
  }
  return text;
}

export interface ViewOptions {
  readonly now?: Date | undefined;
  readonly viewerId?: string | undefined;
}

interface ViewContext {
  readonly locale: LocaleCode;
  readonly now: Date;
  readonly viewerId?: string | undefined;
}

interface Hydrated {
  readonly rows: readonly MatchRow[];
  readonly translations: Map<string, TranslationRow[]>;
  readonly seats: Map<string, number>;
  readonly regions: Awaited<ReturnType<typeof loadRegions>>;
  readonly viewer: Awaited<ReturnType<typeof loadViewerRegistrations>>;
}

/** Everything a list of matches needs, in a fixed number of queries regardless of page size. */
async function hydrate(
  db: DbOrTx,
  rows: readonly MatchRow[],
  view: ViewContext,
): Promise<Hydrated> {
  const ids = rows.map((r) => r.id);
  const [translations, seats, regions, viewer] = await Promise.all([
    loadTranslations(db, ids),
    loadSeatCounts(db, ids, view.now),
    loadRegions(
      db,
      rows.map((r) => r.regionId),
      view.locale,
    ),
    view.viewerId
      ? loadViewerRegistrations(db, view.viewerId, ids, view.now)
      : Promise.resolve(new Map()),
  ]);
  return { rows, translations, seats, regions, viewer };
}

function summaryOf(row: MatchRow, h: Hydrated, locale: LocaleCode): MatchSummaryDto {
  const translations = h.translations.get(row.id) ?? [];
  const sourceLanguage = row.sourceLanguage as LocaleCode;
  const title = pickLocalized(textOf(translations, 'title'), locale, sourceLanguage);
  if (!title) throw new Error(`Match ${row.id} has no title in any language`);
  const region = h.regions.get(row.regionId);
  if (!region) throw new Error(`Match ${row.id} references a missing region`);
  const registeredCount = h.seats.get(row.id) ?? 0;
  return {
    id: row.id,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    venueName: row.venueName,
    venueAddress: row.venueAddress,
    region,
    playersPerSide: row.playersPerSide,
    maxPlayers: row.maxPlayers,
    registeredCount,
    spotsLeft: Math.max(0, row.maxPlayers - registeredCount),
    feeKrw: row.feeKrw,
    sourceLanguage,
    title,
    viewer: h.viewer.get(row.id) ?? null,
  };
}

function detailOf(row: MatchRow, h: Hydrated, locale: LocaleCode): MatchDto {
  const translations = h.translations.get(row.id) ?? [];
  const source = row.sourceLanguage as LocaleCode;
  const field = (name: TranslatedField) =>
    pickLocalized(textOf(translations, name), locale, source);
  return {
    ...summaryOf(row, h, locale),
    description: field('description'),
    rules: field('rules'),
    locationInstructions: field('locationInstructions'),
    equipmentRequirements: field('equipmentRequirements'),
    cancellationPolicy: field('cancellationPolicy'),
  };
}

/** Localized summaries for the given matches (used by registrations, profiles and admin lists). */
export async function loadMatchSummaries(
  db: DbOrTx,
  matchIds: readonly string[],
  locale: LocaleCode,
  options: ViewOptions = {},
): Promise<Map<string, MatchSummaryDto>> {
  const out = new Map<string, MatchSummaryDto>();
  if (matchIds.length === 0) return out;
  const rows = await db
    .select()
    .from(matches)
    .where(inArray(matches.id, [...matchIds]));
  const h = await hydrate(db, rows, {
    locale,
    now: options.now ?? new Date(),
    viewerId: options.viewerId,
  });
  for (const row of rows) out.set(row.id, summaryOf(row, h, locale));
  return out;
}

export interface FeedQuery {
  readonly region?: string | undefined;
  /** `YYYY-MM-DD` in Korean time. */
  readonly date?: string | undefined;
  readonly limit: number;
  readonly offset: number;
}

const DAY_MS = 24 * 3600 * 1000;

/** Korean-calendar day bounds. Korea has no DST, so a fixed +09:00 offset is exact. */
function koreanDayRange(date: string): [Date, Date] {
  const start = new Date(`${date}T00:00:00+09:00`);
  if (Number.isNaN(start.getTime())) throw invalidField('date', 'invalid_date');
  return [start, new Date(start.getTime() + DAY_MS)];
}

/**
 * Upcoming matches, soonest first, optionally limited to a region (a province includes all of its
 * districts) and/or one Korean calendar day.
 */
export async function listUpcomingMatches(
  db: Db,
  locale: LocaleCode,
  query: FeedQuery,
  options: ViewOptions = {},
): Promise<Page<MatchSummaryDto>> {
  const now = options.now ?? new Date();
  const conditions = [gte(matches.startsAt, now)];
  if (query.region)
    conditions.push(inArray(matches.regionId, await regionScopeIds(db, query.region)));
  if (query.date) {
    const [from, to] = koreanDayRange(query.date);
    conditions.push(gte(matches.startsAt, from), lt(matches.startsAt, to));
  }
  const rows = await db
    .select()
    .from(matches)
    .where(and(...conditions))
    .orderBy(asc(matches.startsAt), asc(matches.id))
    .limit(query.limit)
    .offset(query.offset);
  const h = await hydrate(db, rows, { locale, now, viewerId: options.viewerId });
  return {
    items: rows.map((row) => summaryOf(row, h, locale)),
    limit: query.limit,
    offset: query.offset,
  };
}

export async function getMatch(
  db: Db,
  id: string,
  locale: LocaleCode,
  options: ViewOptions = {},
): Promise<MatchDto> {
  const [row] = await db.select().from(matches).where(eq(matches.id, id)).limit(1);
  if (!row) throw notFound('MATCH_NOT_FOUND');
  const h = await hydrate(db, [row], {
    locale,
    now: options.now ?? new Date(),
    viewerId: options.viewerId,
  });
  return detailOf(row, h, locale);
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
  const region = (await loadRegions(db, [row.regionId], 'ko')).get(row.regionId);
  if (!region) throw new Error(`Match ${id} references a missing region`);
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
  return {
    sourceLanguage: row.sourceLanguage as LocaleCode,
    regionCode: region.code,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    venueName: row.venueName,
    venueAddress: row.venueAddress,
    playersPerSide: row.playersPerSide,
    maxPlayers: row.maxPlayers,
    translations,
  };
}
