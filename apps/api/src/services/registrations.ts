import type {
  AdminPaymentDto,
  PaymentRejectReason,
  PaymentStatus,
  Page,
  RegistrationDto,
  RegistrationPaymentDto,
  RegistrationStatus,
} from '@foodboll/contracts';
import { isLocaleCode, type LocaleCode } from '@foodboll/i18n';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AuthUser } from '../context';
import type { Db, DbOrTx } from '../db/client';
import { matches, matchRegistrations, registrationPayments, users } from '../db/schema';
import { AppError, notFound } from '../errors';
import { contentTypeForKey, sniffReceiptType, type ReceiptStorage } from '../storage';
import { loadMatchSummaries } from './matches';
import { enqueueNotification } from './notifications';

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const PAYMENT_WINDOW_MS = 24 * 3600 * 1000;
const NOTIFY_CHANNELS = ['PUSH'] as const;

type RegistrationRow = typeof matchRegistrations.$inferSelect;
type PaymentRow = typeof registrationPayments.$inferSelect;

const invalidState = () => new AppError('INVALID_STATE', 409);

/**
 * Releases seats held by registrations whose payment window lapsed without a receipt. Done lazily
 * (before counting capacity or listing) so no background job is needed for correctness.
 */
async function releaseExpiredSeats(
  db: DbOrTx,
  scope: { matchId: string } | { userId: string },
  now: Date,
): Promise<void> {
  const where =
    'matchId' in scope ? sql`r.match_id = ${scope.matchId}` : sql`r.user_id = ${scope.userId}`;
  await db.execute(sql`
    update match_registrations r
       set status = 'CANCELLED', updated_at = ${now.toISOString()}::timestamptz
     where r.status = 'APPLIED'
       and ${where}
       and exists (
         select 1 from registration_payments p
          where p.registration_id = r.id
            and p.status in ('AWAITING_PAYMENT', 'PAYMENT_REJECTED')
            and p.due_at < ${now.toISOString()}::timestamptz)`);
}

function toPaymentDto(payment: PaymentRow): RegistrationPaymentDto {
  return {
    status: payment.status as PaymentStatus,
    amountKrw: payment.amountKrw,
    dueAt: payment.dueAt.toISOString(),
    hasReceipt: payment.receiptKey !== null,
    rejectReason: payment.rejectReason as PaymentRejectReason | null,
  };
}

async function toRegistrationDtos(
  db: DbOrTx,
  rows: readonly { registration: RegistrationRow; payment: PaymentRow | null }[],
  locale: LocaleCode,
): Promise<RegistrationDto[]> {
  const summaries = await loadMatchSummaries(
    db,
    [...new Set(rows.map((r) => r.registration.matchId))],
    locale,
  );
  return rows.map(({ registration, payment }) => {
    const match = summaries.get(registration.matchId);
    if (!match) throw new Error(`Registration ${registration.id} references a missing match`);
    return {
      id: registration.id,
      status: registration.status as RegistrationStatus,
      createdAt: registration.createdAt.toISOString(),
      match,
      payment: payment ? toPaymentDto(payment) : null,
    };
  });
}

async function loadOne(db: DbOrTx, registrationId: string) {
  const [row] = await db
    .select({ registration: matchRegistrations, payment: registrationPayments })
    .from(matchRegistrations)
    .leftJoin(registrationPayments, eq(registrationPayments.registrationId, matchRegistrations.id))
    .where(eq(matchRegistrations.id, registrationId))
    .limit(1);
  return row ?? null;
}

export async function getRegistrationDto(
  db: DbOrTx,
  registrationId: string,
  locale: LocaleCode,
): Promise<RegistrationDto> {
  const row = await loadOne(db, registrationId);
  if (!row) throw notFound('REGISTRATION_NOT_FOUND');
  return (await toRegistrationDtos(db, [row], locale))[0] as RegistrationDto;
}

/** Locks the registration row so concurrent state changes serialize. */
async function lockRegistration(db: DbOrTx, registrationId: string) {
  const [locked] = await db
    .select()
    .from(matchRegistrations)
    .where(eq(matchRegistrations.id, registrationId))
    .for('update');
  if (!locked) throw notFound('REGISTRATION_NOT_FOUND');
  const [payment] = await db
    .select()
    .from(registrationPayments)
    .where(eq(registrationPayments.registrationId, registrationId));
  return { registration: locked, payment: payment ?? null };
}

/** A player's own registration, or 404 (never reveals that someone else's id exists). */
async function lockOwned(db: DbOrTx, user: AuthUser, registrationId: string) {
  const locked = await lockRegistration(db, registrationId);
  if (locked.registration.userId !== user.id) throw notFound('REGISTRATION_NOT_FOUND');
  return locked;
}

export async function applyToMatch(
  db: Db,
  user: AuthUser,
  matchId: string,
  now: Date = new Date(),
): Promise<string> {
  return db.transaction(async (tx) => {
    // The match row is the lock that serializes seat allocation, so capacity cannot be exceeded.
    const [match] = await tx.select().from(matches).where(eq(matches.id, matchId)).for('update');
    if (!match) throw notFound('MATCH_NOT_FOUND');
    if (match.startsAt <= now) throw new AppError('MATCH_STARTED', 409);

    await releaseExpiredSeats(tx, { matchId }, now);

    const [existing] = await tx
      .select()
      .from(matchRegistrations)
      .where(and(eq(matchRegistrations.matchId, matchId), eq(matchRegistrations.userId, user.id)));
    if (existing && existing.status !== 'CANCELLED') throw new AppError('ALREADY_REGISTERED', 409);
    if (existing) {
      const [payment] = await tx
        .select()
        .from(registrationPayments)
        .where(eq(registrationPayments.registrationId, existing.id));
      // Money is in flight or held: an admin must refund before the player can re-apply.
      if (
        payment &&
        (payment.status === 'PAYMENT_CONFIRMED' || payment.status === 'PAYMENT_REVIEW')
      ) {
        throw invalidState();
      }
    }

    const [{ taken } = { taken: 0 }] = await tx
      .select({ taken: sql<number>`count(*)::int` })
      .from(matchRegistrations)
      .where(
        and(
          eq(matchRegistrations.matchId, matchId),
          inArray(matchRegistrations.status, ['APPLIED', 'CONFIRMED']),
        ),
      );
    if (taken >= match.maxPlayers) throw new AppError('MATCH_FULL', 409);

    const free = match.feeKrw === 0;
    const status: RegistrationStatus = free ? 'CONFIRMED' : 'APPLIED';
    const [registration] = existing
      ? await tx
          .update(matchRegistrations)
          .set({ status, updatedAt: now })
          .where(eq(matchRegistrations.id, existing.id))
          .returning()
      : await tx
          .insert(matchRegistrations)
          .values({ matchId, userId: user.id, status })
          .returning();
    if (!registration) throw new Error('Registration upsert returned no row');

    if (free) {
      await tx
        .delete(registrationPayments)
        .where(eq(registrationPayments.registrationId, registration.id));
      await enqueueNotification(tx, {
        userId: user.id,
        type: 'PARTICIPATION_CONFIRMED',
        channels: NOTIFY_CHANNELS,
      });
    } else {
      const dueAt = new Date(Math.min(now.getTime() + PAYMENT_WINDOW_MS, match.startsAt.getTime()));
      const fresh = {
        amountKrw: match.feeKrw,
        status: 'AWAITING_PAYMENT',
        dueAt,
        receiptKey: null,
        receiptContentType: null,
        receiptUploadedAt: null,
        reviewedBy: null,
        reviewedAt: null,
        rejectReason: null,
        updatedAt: now,
      };
      await tx
        .insert(registrationPayments)
        .values({ registrationId: registration.id, ...fresh })
        .onConflictDoUpdate({ target: registrationPayments.registrationId, set: fresh });
    }
    return registration.id;
  });
}

export async function listMyRegistrations(
  db: Db,
  user: AuthUser,
  locale: LocaleCode,
  page: { limit: number; offset: number },
  now: Date = new Date(),
): Promise<Page<RegistrationDto>> {
  await releaseExpiredSeats(db, { userId: user.id }, now);
  const rows = await db
    .select({ registration: matchRegistrations, payment: registrationPayments })
    .from(matchRegistrations)
    .leftJoin(registrationPayments, eq(registrationPayments.registrationId, matchRegistrations.id))
    .where(eq(matchRegistrations.userId, user.id))
    .orderBy(desc(matchRegistrations.createdAt), desc(matchRegistrations.id))
    .limit(page.limit)
    .offset(page.offset);
  return {
    items: await toRegistrationDtos(db, rows, locale),
    limit: page.limit,
    offset: page.offset,
  };
}

export async function cancelRegistration(
  db: Db,
  user: AuthUser,
  registrationId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const { registration } = await lockOwned(tx, user, registrationId);
    if (registration.status === 'CANCELLED') throw invalidState();
    const [match] = await tx.select().from(matches).where(eq(matches.id, registration.matchId));
    if (!match || match.startsAt <= now) throw new AppError('MATCH_STARTED', 409);
    await tx
      .update(matchRegistrations)
      .set({ status: 'CANCELLED', updatedAt: now })
      .where(eq(matchRegistrations.id, registrationId));
  });
}

/**
 * Stores the receipt and moves the payment to review. The file type is detected from its bytes;
 * anything that is not a JPEG, PNG or PDF is rejected.
 */
export async function uploadReceipt(
  db: Db,
  storage: ReceiptStorage,
  user: AuthUser,
  registrationId: string,
  bytes: Buffer,
  now: Date = new Date(),
): Promise<void> {
  const type = sniffReceiptType(bytes);
  if (!type || bytes.length > MAX_RECEIPT_BYTES) throw new AppError('INVALID_RECEIPT', 422);

  let newKey: string | null = null;
  let oldKey: string | null = null;
  try {
    await db.transaction(async (tx) => {
      const { registration, payment } = await lockOwned(tx, user, registrationId);
      if (!payment || registration.status !== 'APPLIED') throw invalidState();
      if (payment.status !== 'AWAITING_PAYMENT' && payment.status !== 'PAYMENT_REJECTED') {
        throw invalidState();
      }
      if (payment.dueAt < now) throw invalidState();
      oldKey = payment.receiptKey;
      newKey = await storage.put(bytes, type);
      await tx
        .update(registrationPayments)
        .set({
          status: 'PAYMENT_REVIEW',
          receiptKey: newKey,
          receiptContentType: type,
          receiptUploadedAt: now,
          rejectReason: null,
          updatedAt: now,
        })
        .where(eq(registrationPayments.id, payment.id));
    });
  } catch (error) {
    if (newKey) await storage.delete(newKey).catch(() => undefined);
    throw error;
  }
  if (oldKey) await storage.delete(oldKey).catch(() => undefined);
}

/** Receipt bytes for the owner or an admin. */
export async function readReceipt(
  db: Db,
  storage: ReceiptStorage,
  actor: AuthUser,
  registrationId: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const row = await loadOne(db, registrationId);
  const allowed = row && (actor.role === 'ADMIN' || row.registration.userId === actor.id);
  if (!allowed) throw notFound('REGISTRATION_NOT_FOUND');
  const key = row.payment?.receiptKey;
  if (!key) throw notFound('RECEIPT_NOT_FOUND');
  const bytes = await storage.get(key);
  const contentType = contentTypeForKey(key);
  if (!bytes || !contentType) throw notFound('RECEIPT_NOT_FOUND');
  return { bytes, contentType };
}

// ---- Admin -------------------------------------------------------------------------------

export async function listPaymentsForAdmin(
  db: Db,
  locale: LocaleCode,
  filter: { status: PaymentStatus; limit: number; offset: number },
): Promise<Page<AdminPaymentDto>> {
  const rows = await db
    .select({ registration: matchRegistrations, payment: registrationPayments, user: users })
    .from(registrationPayments)
    .innerJoin(matchRegistrations, eq(matchRegistrations.id, registrationPayments.registrationId))
    .innerJoin(users, eq(users.id, matchRegistrations.userId))
    .where(eq(registrationPayments.status, filter.status))
    // Oldest receipts first: people have been waiting longest.
    .orderBy(asc(registrationPayments.receiptUploadedAt), asc(registrationPayments.id))
    .limit(filter.limit)
    .offset(filter.offset);
  const summaries = await loadMatchSummaries(
    db,
    [...new Set(rows.map((r) => r.registration.matchId))],
    locale,
  );
  return {
    items: rows.map((r) => {
      const match = summaries.get(r.registration.matchId);
      if (!match) throw new Error('Payment references a missing match');
      return {
        registrationId: r.registration.id,
        user: {
          id: r.user.id,
          displayName: r.user.displayName,
          preferredLanguage: isLocaleCode(r.user.preferredLanguage)
            ? r.user.preferredLanguage
            : null,
        },
        match,
        registrationStatus: r.registration.status as RegistrationStatus,
        payment: toPaymentDto(r.payment),
        receiptUploadedAt: r.payment.receiptUploadedAt?.toISOString() ?? null,
      };
    }),
    limit: filter.limit,
    offset: filter.offset,
  };
}

async function lockReviewable(db: DbOrTx, registrationId: string) {
  const { registration, payment } = await lockRegistration(db, registrationId);
  if (!payment) throw invalidState();
  return { registration, payment };
}

export async function confirmPayment(
  db: Db,
  admin: AuthUser,
  registrationId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const { registration, payment } = await lockReviewable(tx, registrationId);
    if (payment.status !== 'PAYMENT_REVIEW' || registration.status !== 'APPLIED') {
      throw invalidState();
    }
    await tx
      .update(registrationPayments)
      .set({
        status: 'PAYMENT_CONFIRMED',
        reviewedBy: admin.id,
        reviewedAt: now,
        rejectReason: null,
        updatedAt: now,
      })
      .where(eq(registrationPayments.id, payment.id));
    await tx
      .update(matchRegistrations)
      .set({ status: 'CONFIRMED', updatedAt: now })
      .where(eq(matchRegistrations.id, registrationId));
    // Same transaction: the player is told if and only if the confirmation really happened.
    for (const type of ['PAYMENT_CONFIRMED', 'PARTICIPATION_CONFIRMED'] as const) {
      await enqueueNotification(tx, {
        userId: registration.userId,
        type,
        channels: NOTIFY_CHANNELS,
      });
    }
  });
}

export async function rejectPayment(
  db: Db,
  admin: AuthUser,
  registrationId: string,
  reason: PaymentRejectReason,
  now: Date = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const { registration, payment } = await lockReviewable(tx, registrationId);
    if (payment.status !== 'PAYMENT_REVIEW' || registration.status !== 'APPLIED') {
      throw invalidState();
    }
    await tx
      .update(registrationPayments)
      .set({
        status: 'PAYMENT_REJECTED',
        reviewedBy: admin.id,
        reviewedAt: now,
        rejectReason: reason,
        updatedAt: now,
      })
      .where(eq(registrationPayments.id, payment.id));
    await enqueueNotification(tx, {
      userId: registration.userId,
      type: 'PAYMENT_REJECTED',
      channels: NOTIFY_CHANNELS,
      localizedParams: { reason: `payment.rejectReason.${reason}` },
    });
  });
}

/** Marks money as returned. Only for cancelled registrations whose payment was received. */
export async function refundPayment(
  db: Db,
  admin: AuthUser,
  registrationId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const { registration, payment } = await lockReviewable(tx, registrationId);
    const refundable =
      payment.status === 'PAYMENT_CONFIRMED' || payment.status === 'PAYMENT_REVIEW';
    if (!refundable || registration.status !== 'CANCELLED') throw invalidState();
    await tx
      .update(registrationPayments)
      .set({ status: 'REFUNDED', reviewedBy: admin.id, reviewedAt: now, updatedAt: now })
      .where(eq(registrationPayments.id, payment.id));
  });
}

export async function getAdminPayment(
  db: Db,
  locale: LocaleCode,
  registrationId: string,
): Promise<AdminPaymentDto> {
  const row = await loadOne(db, registrationId);
  if (!row?.payment) throw notFound('REGISTRATION_NOT_FOUND');
  const [user] = await db.select().from(users).where(eq(users.id, row.registration.userId));
  const summaries = await loadMatchSummaries(db, [row.registration.matchId], locale);
  const match = summaries.get(row.registration.matchId);
  if (!user || !match) throw new Error('Registration references missing rows');
  return {
    registrationId,
    user: {
      id: user.id,
      displayName: user.displayName,
      preferredLanguage: isLocaleCode(user.preferredLanguage) ? user.preferredLanguage : null,
    },
    match,
    registrationStatus: row.registration.status as RegistrationStatus,
    payment: toPaymentDto(row.payment),
    receiptUploadedAt: row.payment.receiptUploadedAt?.toISOString() ?? null,
  };
}
