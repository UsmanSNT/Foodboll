import type {
  AdminUserDto,
  OrganizerApplicationDto,
  OrganizerApplicationStatus,
  Page,
} from '@foodboll/contracts';
import type { LocaleCode } from '@foodboll/i18n';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AuthUser } from '../context';
import type { Db, DbOrTx } from '../db/client';
import { organizerApplications, organizerRegions, regions, users } from '../db/schema';
import { AppError, forbidden, notFound } from '../errors';
import { enqueueNotification } from './notifications';
import { findRegionByCode, loadRegions } from './regions';

const MAX_OPEN_APPLICATIONS = 3;

/**
 * May this person publish a match in `regionId`? Admins always; organizers only inside a region
 * they were granted (a province grant covers its districts).
 */
export async function canPublishIn(
  db: DbOrTx,
  actor: AuthUser,
  regionId: string,
): Promise<boolean> {
  if (actor.role === 'ADMIN') return true;
  if (actor.role !== 'ORGANIZER') return false;
  const [granted] = await db
    .select({ one: sql<number>`1` })
    .from(organizerRegions)
    .innerJoin(regions, eq(regions.id, regionId))
    .where(
      and(
        eq(organizerRegions.userId, actor.id),
        sql`${organizerRegions.regionId} in (${regions.id}, ${regions.parentId})`,
      ),
    )
    .limit(1);
  return granted !== undefined;
}

export async function assertCanPublishIn(
  db: DbOrTx,
  actor: AuthUser,
  regionId: string,
): Promise<void> {
  if (!(await canPublishIn(db, actor, regionId))) {
    throw actor.role === 'PLAYER' ? forbidden() : new AppError('REGION_FORBIDDEN', 403);
  }
}

export async function listOrganizerRegionCodes(
  db: DbOrTx,
  userIds: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (userIds.length === 0) return out;
  const rows = await db
    .select({ userId: organizerRegions.userId, code: regions.code })
    .from(organizerRegions)
    .innerJoin(regions, eq(regions.id, organizerRegions.regionId))
    .where(inArray(organizerRegions.userId, [...userIds]))
    .orderBy(asc(regions.code));
  for (const row of rows) out.set(row.userId, [...(out.get(row.userId) ?? []), row.code]);
  return out;
}

/** Regions an organizer was granted, localized, for their own screens. */
export async function listMyOrganizerRegions(db: Db, user: AuthUser, locale: LocaleCode) {
  const rows = await db
    .select({ regionId: organizerRegions.regionId })
    .from(organizerRegions)
    .where(eq(organizerRegions.userId, user.id));
  const map = await loadRegions(
    db,
    rows.map((r) => r.regionId),
    locale,
  );
  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
}

type ApplicationRow = typeof organizerApplications.$inferSelect;

async function toDtos(
  db: DbOrTx,
  rows: readonly ApplicationRow[],
  locale: LocaleCode,
): Promise<OrganizerApplicationDto[]> {
  const [regionMap, applicants] = await Promise.all([
    loadRegions(
      db,
      rows.map((r) => r.regionId),
      locale,
    ),
    rows.length
      ? db
          .select({ id: users.id, displayName: users.displayName })
          .from(users)
          .where(inArray(users.id, [...new Set(rows.map((r) => r.userId))]))
      : Promise.resolve([]),
  ]);
  const applicantById = new Map(applicants.map((a) => [a.id, a]));
  return rows.flatMap((row) => {
    const region = regionMap.get(row.regionId);
    const applicant = applicantById.get(row.userId);
    if (!region || !applicant) return [];
    return [
      {
        id: row.id,
        status: row.status as OrganizerApplicationStatus,
        region,
        message: row.message,
        createdAt: row.createdAt.toISOString(),
        reviewedAt: row.reviewedAt?.toISOString() ?? null,
        applicant,
      },
    ];
  });
}

export async function applyToOrganize(
  db: Db,
  user: AuthUser,
  input: { regionCode: string; message: string | null },
  locale: LocaleCode,
): Promise<OrganizerApplicationDto> {
  const row = await db.transaction(async (tx) => {
    const region = await findRegionByCode(tx, input.regionCode);
    // Already allowed to publish there: nothing to apply for.
    if (await canPublishIn(tx, user, region.id)) throw new AppError('INVALID_STATE', 409);
    const [{ open } = { open: 0 }] = await tx
      .select({ open: sql<number>`count(*)::int` })
      .from(organizerApplications)
      .where(
        and(eq(organizerApplications.userId, user.id), eq(organizerApplications.status, 'PENDING')),
      );
    if (open >= MAX_OPEN_APPLICATIONS) throw new AppError('INVALID_STATE', 409);
    const inserted = await tx
      .insert(organizerApplications)
      .values({ userId: user.id, regionId: region.id, message: input.message })
      .onConflictDoNothing()
      .returning();
    // The partial unique index turned a duplicate open application into a no-op.
    if (inserted.length === 0) throw new AppError('INVALID_STATE', 409);
    return inserted[0] as ApplicationRow;
  });
  return (await toDtos(db, [row], locale))[0] as OrganizerApplicationDto;
}

export async function listMyApplications(
  db: Db,
  user: AuthUser,
  locale: LocaleCode,
): Promise<OrganizerApplicationDto[]> {
  const rows = await db
    .select()
    .from(organizerApplications)
    .where(eq(organizerApplications.userId, user.id))
    .orderBy(desc(organizerApplications.createdAt));
  return toDtos(db, rows, locale);
}

export async function listApplicationsForAdmin(
  db: Db,
  locale: LocaleCode,
  filter: { status: OrganizerApplicationStatus; limit: number; offset: number },
): Promise<Page<OrganizerApplicationDto>> {
  const rows = await db
    .select()
    .from(organizerApplications)
    .where(eq(organizerApplications.status, filter.status))
    .orderBy(asc(organizerApplications.createdAt), asc(organizerApplications.id))
    .limit(filter.limit)
    .offset(filter.offset);
  return { items: await toDtos(db, rows, locale), limit: filter.limit, offset: filter.offset };
}

async function decide(
  db: Db,
  admin: AuthUser,
  applicationId: string,
  decision: 'APPROVED' | 'REJECTED',
  now: Date,
): Promise<ApplicationRow> {
  return db.transaction(async (tx) => {
    const [application] = await tx
      .select()
      .from(organizerApplications)
      .where(eq(organizerApplications.id, applicationId))
      .for('update');
    if (!application) throw notFound('APPLICATION_NOT_FOUND');
    if (application.status !== 'PENDING') throw new AppError('INVALID_STATE', 409);

    const [updated] = await tx
      .update(organizerApplications)
      .set({ status: decision, reviewedBy: admin.id, reviewedAt: now })
      .where(eq(organizerApplications.id, applicationId))
      .returning();
    if (decision === 'APPROVED') {
      await tx
        .insert(organizerRegions)
        .values({ userId: application.userId, regionId: application.regionId })
        .onConflictDoNothing();
      // Promote players; never demote an admin who happens to apply.
      await tx
        .update(users)
        .set({ role: 'ORGANIZER', updatedAt: now })
        .where(and(eq(users.id, application.userId), eq(users.role, 'PLAYER')));
    }
    await enqueueNotification(tx, {
      userId: application.userId,
      type: decision === 'APPROVED' ? 'ORGANIZER_APPROVED' : 'ORGANIZER_REJECTED',
    });
    return updated as ApplicationRow;
  });
}

export async function decideApplication(
  db: Db,
  admin: AuthUser,
  applicationId: string,
  decision: 'APPROVED' | 'REJECTED',
  locale: LocaleCode,
  now: Date = new Date(),
): Promise<OrganizerApplicationDto> {
  const row = await decide(db, admin, applicationId, decision, now);
  return (await toDtos(db, [row], locale))[0] as OrganizerApplicationDto;
}

/**
 * Replaces the regions a user may publish in. Granting any region makes a player an organizer;
 * clearing them makes an organizer a player again. Admins are never changed.
 */
export async function setOrganizerRegions(
  db: Db,
  userId: string,
  regionCodes: readonly string[],
  now: Date = new Date(),
): Promise<AdminUserDto['organizerRegions']> {
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
    if (!user) throw notFound();
    if (user.role === 'ADMIN') throw new AppError('INVALID_STATE', 409);
    const unique = [...new Set(regionCodes)];
    const found = unique.length
      ? await tx
          .select({ id: regions.id, code: regions.code })
          .from(regions)
          .where(inArray(regions.code, unique))
      : [];
    if (found.length !== unique.length) throw notFound('REGION_NOT_FOUND');

    await tx.delete(organizerRegions).where(eq(organizerRegions.userId, userId));
    if (found.length) {
      await tx.insert(organizerRegions).values(found.map((r) => ({ userId, regionId: r.id })));
    }
    await tx
      .update(users)
      .set({ role: found.length ? 'ORGANIZER' : 'PLAYER', updatedAt: now })
      .where(eq(users.id, userId));
    return found.map((r) => r.code).sort();
  });
}
