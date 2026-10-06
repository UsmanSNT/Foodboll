import {
  activityLevel,
  computeXp,
  earnedAchievements,
  levelFromXp,
  type Page,
  type PlayerCardDto,
  type PlayerProfileDto,
  type PlayerStatsDto,
  type RosterEntryDto,
  type UserRole,
} from '@foodboll/contracts';
import type { LocaleCode } from '@foodboll/i18n';
import { and, asc, desc, eq, ilike, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { AuthUser } from '../context';
import type { Db, DbOrTx } from '../db/client';
import { matches, matchRegistrations, regions, users } from '../db/schema';
import { AppError, forbidden, notFound } from '../errors';
import { loadMatchSummaries } from './matches';
import { loadRegions, regionScopeIds } from './regions';

const DAY_MS = 24 * 3600 * 1000;
/** Organizers can fill in the attendance sheet for this long after a match ends. */
const ATTENDANCE_WINDOW_MS = 14 * DAY_MS;

const asDate = (value: unknown): Date | null =>
  value === null || value === undefined ? null : new Date(value as string | number | Date);

/** Attendance statistics for many players in a fixed number of queries. */
export async function loadPlayerStats(
  db: DbOrTx,
  userIds: readonly string[],
  now: Date,
): Promise<Map<string, PlayerStatsDto>> {
  const out = new Map<string, PlayerStatsDto>();
  if (userIds.length === 0) return out;
  const ids = [...new Set(userIds)];
  const since = new Date(now.getTime() - 90 * DAY_MS);
  const attended = matchRegistrations.attended;

  const [played, organized] = await Promise.all([
    db
      .select({
        userId: matchRegistrations.userId,
        played: sql<number>`count(*) filter (where ${attended} is true)::int`,
        noShows: sql<number>`count(*) filter (where ${attended} is false)::int`,
        last90: sql<number>`count(*) filter (where ${attended} is true and ${matches.startsAt} >= ${since.toISOString()}::timestamptz)::int`,
        firstAt: sql<unknown>`min(${matches.startsAt}) filter (where ${attended} is true)`,
        lastAt: sql<unknown>`max(${matches.startsAt}) filter (where ${attended} is true)`,
        provinces: sql<number>`count(distinct coalesce(${regions.parentId}, ${regions.id})) filter (where ${attended} is true)::int`,
      })
      .from(matchRegistrations)
      .innerJoin(matches, eq(matches.id, matchRegistrations.matchId))
      .innerJoin(regions, eq(regions.id, matches.regionId))
      .where(and(inArray(matchRegistrations.userId, ids), isNotNull(attended)))
      .groupBy(matchRegistrations.userId),
    db
      .select({ userId: matches.organizerId, n: sql<number>`count(*)::int` })
      .from(matches)
      .where(and(inArray(matches.organizerId, ids), lt(matches.endsAt, now)))
      .groupBy(matches.organizerId),
  ]);

  const organizedBy = new Map(organized.map((r) => [r.userId, r.n]));
  const playedBy = new Map(played.map((r) => [r.userId, r]));
  for (const id of ids) {
    const row = playedBy.get(id);
    const marked = (row?.played ?? 0) + (row?.noShows ?? 0);
    out.set(id, {
      matchesPlayed: row?.played ?? 0,
      matchesOrganized: organizedBy.get(id) ?? 0,
      noShows: row?.noShows ?? 0,
      attendanceRate: marked === 0 ? null : (row?.played ?? 0) / marked,
      last90Days: row?.last90 ?? 0,
      firstMatchAt: asDate(row?.firstAt)?.toISOString() ?? null,
      lastMatchAt: asDate(row?.lastAt)?.toISOString() ?? null,
      provincesPlayed: row?.provinces ?? 0,
    });
  }
  return out;
}

const xpOf = (stats: PlayerStatsDto) => computeXp(stats);

/** Public cards (name, region, level) for many players. */
export async function loadPlayerCards(
  db: DbOrTx,
  userIds: readonly string[],
  locale: LocaleCode,
  now: Date,
): Promise<Map<string, PlayerCardDto>> {
  const out = new Map<string, PlayerCardDto>();
  if (userIds.length === 0) return out;
  const rows = await db
    .select()
    .from(users)
    .where(inArray(users.id, [...new Set(userIds)]));
  const [stats, regionsById] = await Promise.all([
    loadPlayerStats(
      db,
      rows.map((r) => r.id),
      now,
    ),
    loadRegions(
      db,
      rows.flatMap((r) => (r.homeRegionId ? [r.homeRegionId] : [])),
      locale,
    ),
  ]);
  for (const row of rows) {
    const s = stats.get(row.id);
    out.set(row.id, {
      id: row.id,
      displayName: row.displayName,
      homeRegion: row.homeRegionId ? (regionsById.get(row.homeRegionId) ?? null) : null,
      level: levelFromXp(s ? xpOf(s) : 0),
    });
  }
  return out;
}

export async function getPlayerProfile(
  db: Db,
  playerId: string,
  locale: LocaleCode,
  now: Date = new Date(),
): Promise<PlayerProfileDto> {
  const [row] = await db.select().from(users).where(eq(users.id, playerId));
  if (!row) throw notFound('PLAYER_NOT_FOUND');
  const [card, stats, recent] = await Promise.all([
    loadPlayerCards(db, [playerId], locale, now),
    loadPlayerStats(db, [playerId], now),
    db
      .select({ matchId: matchRegistrations.matchId })
      .from(matchRegistrations)
      .innerJoin(matches, eq(matches.id, matchRegistrations.matchId))
      .where(and(eq(matchRegistrations.userId, playerId), eq(matchRegistrations.attended, true)))
      .orderBy(desc(matches.startsAt))
      .limit(5),
  ]);
  const base = card.get(playerId);
  const s = stats.get(playerId);
  if (!base || !s) throw new Error('Profile data missing');
  const summaries = await loadMatchSummaries(
    db,
    recent.map((r) => r.matchId),
    locale,
    { now },
  );
  return {
    ...base,
    role: row.role as UserRole,
    memberSince: row.createdAt.toISOString(),
    xp: xpOf(s),
    stats: s,
    activity: activityLevel({ matchesPlayed: s.matchesPlayed, last90Days: s.last90Days }),
    achievements: earnedAchievements({
      matchesPlayed: s.matchesPlayed,
      noShows: s.noShows,
      matchesOrganized: s.matchesOrganized,
      provincesPlayed: s.provincesPlayed,
    }),
    recentMatches: recent.flatMap((r) => {
      const summary = summaries.get(r.matchId);
      return summary ? [summary] : [];
    }),
  };
}

/** Escapes LIKE wildcards so a search for "100%" is literal. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function searchPlayers(
  db: Db,
  locale: LocaleCode,
  query: { q?: string | undefined; region?: string | undefined; limit: number; offset: number },
  now: Date = new Date(),
): Promise<Page<PlayerCardDto>> {
  const conditions = [];
  if (query.q) conditions.push(ilike(users.displayName, `${escapeLike(query.q)}%`));
  if (query.region)
    conditions.push(inArray(users.homeRegionId, await regionScopeIds(db, query.region)));
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(...conditions))
    .orderBy(asc(sql`lower(${users.displayName})`), asc(users.id))
    .limit(query.limit)
    .offset(query.offset);
  const cards = await loadPlayerCards(
    db,
    rows.map((r) => r.id),
    locale,
    now,
  );
  return {
    items: rows.flatMap((r) => {
      const card = cards.get(r.id);
      return card ? [card] : [];
    }),
    limit: query.limit,
    offset: query.offset,
  };
}

async function ownedMatch(tx: DbOrTx, actor: AuthUser, matchId: string) {
  const [match] = await tx.select().from(matches).where(eq(matches.id, matchId));
  if (!match) throw notFound('MATCH_NOT_FOUND');
  if (actor.role !== 'ADMIN' && match.organizerId !== actor.id) throw forbidden();
  return match;
}

/** Confirmed players of a match with their attendance mark, for the organizer's sheet. */
export async function getRoster(
  db: Db,
  actor: AuthUser,
  matchId: string,
  locale: LocaleCode,
  now: Date = new Date(),
): Promise<RosterEntryDto[]> {
  await ownedMatch(db, actor, matchId);
  const rows = await db
    .select({
      registrationId: matchRegistrations.id,
      userId: matchRegistrations.userId,
      attended: matchRegistrations.attended,
    })
    .from(matchRegistrations)
    .where(and(eq(matchRegistrations.matchId, matchId), eq(matchRegistrations.status, 'CONFIRMED')))
    .orderBy(asc(matchRegistrations.createdAt), asc(matchRegistrations.id));
  const cards = await loadPlayerCards(
    db,
    rows.map((r) => r.userId),
    locale,
    now,
  );
  return rows.flatMap((r) => {
    const player = cards.get(r.userId);
    return player ? [{ registrationId: r.registrationId, player, attended: r.attended }] : [];
  });
}

/** Who is going: confirmed players of a match, visible to signed-in players. */
export async function listMatchPlayers(
  db: Db,
  matchId: string,
  locale: LocaleCode,
  now: Date = new Date(),
): Promise<PlayerCardDto[]> {
  const [match] = await db.select({ id: matches.id }).from(matches).where(eq(matches.id, matchId));
  if (!match) throw notFound('MATCH_NOT_FOUND');
  const rows = await db
    .select({ userId: matchRegistrations.userId })
    .from(matchRegistrations)
    .where(and(eq(matchRegistrations.matchId, matchId), eq(matchRegistrations.status, 'CONFIRMED')))
    .orderBy(asc(matchRegistrations.createdAt), asc(matchRegistrations.id));
  const cards = await loadPlayerCards(
    db,
    rows.map((r) => r.userId),
    locale,
    now,
  );
  return rows.flatMap((r) => {
    const card = cards.get(r.userId);
    return card ? [card] : [];
  });
}

/**
 * Records who really played. The organizer (or an admin) can do it from kick-off until two weeks
 * after the match, and may correct earlier marks inside that window.
 */
export async function markAttendance(
  db: Db,
  actor: AuthUser,
  matchId: string,
  marks: readonly { registrationId: string; attended: boolean }[],
  now: Date = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(matches).where(eq(matches.id, matchId)).for('update');
    if (!locked) throw notFound('MATCH_NOT_FOUND');
    if (actor.role !== 'ADMIN' && locked.organizerId !== actor.id) throw forbidden();
    if (locked.startsAt > now) throw new AppError('MATCH_NOT_STARTED', 409);
    if (now.getTime() - locked.endsAt.getTime() > ATTENDANCE_WINDOW_MS)
      throw new AppError('INVALID_STATE', 409);

    const ids = [...new Set(marks.map((m) => m.registrationId))];
    const found = await tx
      .select({ id: matchRegistrations.id, status: matchRegistrations.status })
      .from(matchRegistrations)
      .where(and(inArray(matchRegistrations.id, ids), eq(matchRegistrations.matchId, matchId)));
    // A registration that is not in this match is reported as missing, never revealed.
    if (found.length !== ids.length) throw notFound('REGISTRATION_NOT_FOUND');
    if (found.some((r) => r.status !== 'CONFIRMED')) throw new AppError('INVALID_STATE', 409);

    for (const mark of marks) {
      await tx
        .update(matchRegistrations)
        .set({ attended: mark.attended, attendanceMarkedAt: now, attendanceMarkedBy: actor.id })
        .where(eq(matchRegistrations.id, mark.registrationId));
    }
  });
}
