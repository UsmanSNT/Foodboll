import type { RegionDto, RegionInput, RegionNodeDto, RegionRefDto } from '@foodboll/contracts';
import {
  DEFAULT_LOCALE,
  isLocaleCode,
  pickLocalized,
  type LocaleCode,
  type LocalizedText,
} from '@foodboll/i18n';
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '../db/client';
import { matches, regions, regionTranslations, users } from '../db/schema';
import { AppError, notFound } from '../errors';
import { assertLanguagesEnabled } from './translations';

type RegionRow = typeof regions.$inferSelect;

/** Region names are proper nouns: fall back to Korean, then to whatever exists. */
function nameOf(
  translations: readonly { languageCode: string; name: string }[],
  locale: LocaleCode,
): RegionRefDto['name'] {
  const text: Partial<Record<LocaleCode, string>> = {};
  for (const t of translations) if (isLocaleCode(t.languageCode)) text[t.languageCode] = t.name;
  const picked = pickLocalized(text as LocalizedText, locale, DEFAULT_LOCALE);
  // A region always has at least its Korean name; this only guards corrupted data.
  return picked ?? { text: '', locale: DEFAULT_LOCALE, isFallback: true };
}

async function loadTranslations(db: DbOrTx, regionIds: readonly string[]) {
  const byRegion = new Map<string, { languageCode: string; name: string }[]>();
  if (regionIds.length === 0) return byRegion;
  const rows = await db
    .select()
    .from(regionTranslations)
    .where(inArray(regionTranslations.regionId, [...regionIds]));
  for (const row of rows) {
    const list = byRegion.get(row.regionId) ?? [];
    list.push(row);
    byRegion.set(row.regionId, list);
  }
  return byRegion;
}

/** Regions (with their parents) by id, localized. Two queries for any number of regions. */
export async function loadRegions(
  db: DbOrTx,
  regionIds: readonly string[],
  locale: LocaleCode,
): Promise<Map<string, RegionDto>> {
  const out = new Map<string, RegionDto>();
  const unique = [...new Set(regionIds)];
  if (unique.length === 0) return out;
  const rows = await db.select().from(regions).where(inArray(regions.id, unique));
  const parentIds = [...new Set(rows.flatMap((r) => (r.parentId ? [r.parentId] : [])))];
  const parents = parentIds.length
    ? await db.select().from(regions).where(inArray(regions.id, parentIds))
    : [];
  const translations = await loadTranslations(
    db,
    [...rows, ...parents].map((r) => r.id),
  );
  const ref = (row: RegionRow): RegionRefDto => ({
    id: row.id,
    code: row.code,
    name: nameOf(translations.get(row.id) ?? [], locale),
  });
  const parentById = new Map(parents.map((p) => [p.id, ref(p)]));
  for (const row of rows) {
    out.set(row.id, {
      ...ref(row),
      level: row.level as 1 | 2,
      parent: row.parentId ? (parentById.get(row.parentId) ?? null) : null,
    });
  }
  return out;
}

export async function findRegionByCode(db: DbOrTx, code: string): Promise<RegionRow> {
  const [row] = await db.select().from(regions).where(eq(regions.code, code));
  if (!row || !row.enabled) throw notFound('REGION_NOT_FOUND');
  return row;
}

/** The region itself plus its districts: choosing a province shows everything inside it. */
export async function regionScopeIds(db: DbOrTx, code: string): Promise<string[]> {
  const region = await findRegionByCode(db, code);
  const children = await db
    .select({ id: regions.id })
    .from(regions)
    .where(and(eq(regions.parentId, region.id), eq(regions.enabled, true)));
  return [region.id, ...children.map((c) => c.id)];
}

/** Full region tree for pickers, with the number of upcoming matches in each (roll-ups included). */
export async function listRegionTree(
  db: Db,
  locale: LocaleCode,
  now: Date = new Date(),
): Promise<RegionNodeDto[]> {
  const rows = await db
    .select()
    .from(regions)
    .where(eq(regions.enabled, true))
    .orderBy(asc(regions.sortOrder), asc(regions.code));
  const translations = await loadTranslations(
    db,
    rows.map((r) => r.id),
  );
  const counts = new Map(
    (
      await db
        .select({ regionId: matches.regionId, n: sql<number>`count(*)::int` })
        .from(matches)
        .where(gte(matches.startsAt, now))
        .groupBy(matches.regionId)
    ).map((r) => [r.regionId, r.n]),
  );

  const nodeOf = (row: RegionRow, children: RegionNodeDto[]): RegionNodeDto => ({
    id: row.id,
    code: row.code,
    name: nameOf(translations.get(row.id) ?? [], locale),
    level: row.level as 1 | 2,
    upcomingMatches:
      (counts.get(row.id) ?? 0) + children.reduce((sum, child) => sum + child.upcomingMatches, 0),
    children,
  });
  const childrenOf = new Map<string, RegionRow[]>();
  for (const row of rows) {
    if (row.parentId) childrenOf.set(row.parentId, [...(childrenOf.get(row.parentId) ?? []), row]);
  }
  return rows
    .filter((r) => r.level === 1)
    .map((r) =>
      nodeOf(
        r,
        (childrenOf.get(r.id) ?? []).map((c) => nodeOf(c, [])),
      ),
    );
}

export async function createRegion(db: Db, input: RegionInput): Promise<string> {
  const names = Object.entries(input.names).filter(([, name]) => name !== undefined) as [
    LocaleCode,
    string,
  ][];
  await assertLanguagesEnabled(
    db,
    names.map(([code]) => code),
  );
  return db.transaction(async (tx) => {
    let parentId: string | null = null;
    if (input.parent !== null) {
      const parent = await findRegionByCode(tx, input.parent);
      // Two levels only: districts hang off provinces.
      if (parent.level !== 1)
        throw new AppError('VALIDATION_FAILED', 400, [{ path: 'parent', issue: 'invalid_value' }]);
      parentId = parent.id;
    }
    const [taken] = await tx
      .select({ id: regions.id })
      .from(regions)
      .where(eq(regions.code, input.code));
    if (taken)
      throw new AppError('VALIDATION_FAILED', 409, [{ path: 'code', issue: 'already_exists' }]);
    const [row] = await tx
      .insert(regions)
      .values({
        code: input.code,
        parentId,
        level: parentId ? 2 : 1,
        sortOrder: input.sortOrder,
      })
      .returning({ id: regions.id });
    if (!row) throw new Error('Region insert returned no row');
    await tx
      .insert(regionTranslations)
      .values(names.map(([languageCode, name]) => ({ regionId: row.id, languageCode, name })));
    return row.id;
  });
}

export async function setRegionEnabled(db: Db, code: string, enabled: boolean): Promise<void> {
  const updated = await db
    .update(regions)
    .set({ enabled })
    .where(eq(regions.code, code))
    .returning({ id: regions.id });
  if (updated.length === 0) throw notFound('REGION_NOT_FOUND');
}

/** Sets (or clears) where the user plays; the match feed defaults to it. */
export async function setHomeRegion(db: Db, userId: string, code: string | null): Promise<void> {
  const regionId = code === null ? null : (await findRegionByCode(db, code)).id;
  await db
    .update(users)
    .set({ homeRegionId: regionId, updatedAt: sql`now()` })
    .where(eq(users.id, userId));
}
