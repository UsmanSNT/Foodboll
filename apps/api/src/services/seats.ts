import type { RegistrationStatus } from '@foodboll/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { matchRegistrations } from '../db/schema';

/** SQL: this registration's payment is unpaid and past its deadline. */
export const lapsedHold = (now: Date) => sql`exists (
  select 1 from registration_payments p
   where p.registration_id = ${matchRegistrations.id}
     and p.status in ('AWAITING_PAYMENT', 'PAYMENT_REJECTED')
     and p.due_at < ${now.toISOString()}::timestamptz)`;

/**
 * Seats currently held per match: confirmed players plus applicants still inside their payment
 * window. Lapsed holds are excluded, so a full match reopens as soon as a window expires.
 */
export async function loadSeatCounts(
  db: DbOrTx,
  matchIds: readonly string[],
  now: Date,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (matchIds.length === 0) return counts;
  const rows = await db
    .select({ matchId: matchRegistrations.matchId, taken: sql<number>`count(*)::int` })
    .from(matchRegistrations)
    .where(
      and(
        inArray(matchRegistrations.matchId, [...matchIds]),
        inArray(matchRegistrations.status, ['APPLIED', 'CONFIRMED']),
        sql`not (${matchRegistrations.status} = 'APPLIED' and ${lapsedHold(now)})`,
      ),
    )
    .groupBy(matchRegistrations.matchId);
  for (const row of rows) counts.set(row.matchId, row.taken);
  return counts;
}

export interface ViewerRegistration {
  readonly registrationId: string;
  readonly status: RegistrationStatus;
}

/** The signed-in user's live registrations for the given matches (cancelled ones are omitted). */
export async function loadViewerRegistrations(
  db: DbOrTx,
  userId: string,
  matchIds: readonly string[],
  now: Date,
): Promise<Map<string, ViewerRegistration>> {
  const out = new Map<string, ViewerRegistration>();
  if (matchIds.length === 0) return out;
  const rows = await db
    .select({
      id: matchRegistrations.id,
      matchId: matchRegistrations.matchId,
      status: matchRegistrations.status,
    })
    .from(matchRegistrations)
    .where(
      and(
        eq(matchRegistrations.userId, userId),
        inArray(matchRegistrations.matchId, [...matchIds]),
        inArray(matchRegistrations.status, ['APPLIED', 'CONFIRMED']),
        sql`not (${matchRegistrations.status} = 'APPLIED' and ${lapsedHold(now)})`,
      ),
    );
  for (const row of rows) {
    out.set(row.matchId, { registrationId: row.id, status: row.status as RegistrationStatus });
  }
  return out;
}
