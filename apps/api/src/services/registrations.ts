import type {
  AdminPaymentDto,
  Page,
  PaymentRejectReason,
  PaymentStatus,
  RegistrationDto,
  RegistrationPaymentDto,
  RegistrationStatus,
} from '@foodboll/contracts';
import { isLocaleCode, type LocaleCode } from '@foodboll/i18n';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AuthUser } from '../context';
import type { Db, DbOrTx } from '../db/client';
import {
  bankDeposits,
  matches,
  matchRegistrations,
  registrationPayments,
  users,
} from '../db/schema';
import { AppError, notFound } from '../errors';
import { contentTypeForKey, sniffReceiptType, type ReceiptStorage } from '../storage';
import { loadMatchSummaries } from './matches';
import { enqueueNotification } from './notifications';
import { recordPaymentEvent } from './payment-audit';
import { lapsedHold } from './seats';

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const PAYMENT_WINDOW_MS = 24 * 3600 * 1000;

type RegistrationRow = typeof matchRegistrations.$inferSelect;
type PaymentRow = typeof registrationPayments.$inferSelect;

const invalidState = () => new AppError('INVALID_STATE', 409);

/** Deadline for the next payment attempt: a full window, but never later than kick-off. */
function paymentDeadline(now: Date, matchStartsAt: Date): Date {
  return new Date(Math.min(now.getTime() + PAYMENT_WINDOW_MS, matchStartsAt.getTime()));
}

/**
 * The status a reader should see. An unpaid registration past its deadline is shown as cancelled
 * even before the seat is physically released, so reads never need to write.
 */
function effectiveStatus(
  registration: RegistrationRow,
  payment: PaymentRow | null,
  now: Date,
): RegistrationStatus {
  const status = registration.status as RegistrationStatus;
  const unpaid = payment?.status === 'AWAITING_PAYMENT' || payment?.status === 'PAYMENT_REJECTED';
  return status === 'APPLIED' && unpaid && payment.dueAt < now ? 'CANCELLED' : status;
}

/**
 * Releases the seats of registrations whose payment window lapsed. Runs only inside the apply
 * transaction (which holds the match lock).
 *
 * Two statements on purpose: the first locks candidate rows (skipping any row an in-flight
 * receipt upload holds); the second re-checks the condition with a fresh snapshot, so a receipt
 * committed just before the lock was acquired is seen and the registration is left alone.
 */
async function releaseLapsedSeats(
  db: DbOrTx,
  /** Null releases lapsed holds of every match (bounded by `limit`). */
  matchId: string | null,
  now: Date,
  limit?: number,
): Promise<{ id: string; receiptKey: string | null }[]> {
  const candidateQuery = db
    .select({ id: matchRegistrations.id })
    .from(matchRegistrations)
    .where(
      and(
        matchId === null ? undefined : eq(matchRegistrations.matchId, matchId),
        eq(matchRegistrations.status, 'APPLIED'),
        lapsedHold(now),
      ),
    );
  const candidates = await (limit === undefined ? candidateQuery : candidateQuery.limit(limit)).for(
    'update',
    { skipLocked: true },
  );
  if (candidates.length === 0) return [];

  const released = await db
    .update(matchRegistrations)
    .set({ status: 'CANCELLED', updatedAt: now })
    .where(
      and(
        inArray(
          matchRegistrations.id,
          candidates.map((c) => c.id),
        ),
        eq(matchRegistrations.status, 'APPLIED'),
        lapsedHold(now),
      ),
    )
    .returning({ id: matchRegistrations.id });
  if (released.length === 0) return [];

  // The seat is gone, so the code is free again for someone else.
  await db
    .update(registrationPayments)
    .set({ referenceCode: null })
    .where(
      inArray(
        registrationPayments.registrationId,
        released.map((r) => r.id),
      ),
    );
  const payments = await db
    .select()
    .from(registrationPayments)
    .where(
      inArray(
        registrationPayments.registrationId,
        released.map((r) => r.id),
      ),
    );
  for (const payment of payments) {
    await recordPaymentEvent(db, {
      registrationId: payment.registrationId,
      event: 'EXPIRED',
      fromStatus: payment.status,
      toStatus: payment.status,
      amountKrw: payment.amountKrw,
    });
  }
  return payments.map((p) => ({ id: p.registrationId, receiptKey: p.receiptKey }));
}

const EXPECTING = ['AWAITING_PAYMENT', 'PAYMENT_REVIEW', 'PAYMENT_REJECTED'];

/**
 * Picks a 4-digit code not used by any payment still expected (years 1900-2100 are skipped so a
 * code is never confused with a date in a bank message). Serialized by an advisory lock, because
 * applications to different matches run concurrently and the unique index is only a backstop.
 */
async function drawReferenceCode(tx: DbOrTx): Promise<string | undefined> {
  const result = await tx.execute(sql`
    select lpad(n::text, 4, '0') as code
      from generate_series(0, 9999) n
     where n not between 1900 and 2100
       and not exists (
         select 1 from registration_payments p
          where p.reference_code = lpad(n::text, 4, '0')
            and p.status in ('AWAITING_PAYMENT', 'PAYMENT_REVIEW', 'PAYMENT_REJECTED'))
     order by random() limit 1`);
  return (result.rows[0] as { code?: string } | undefined)?.code;
}

/**
 * Codes of lapsed holds stay allocated until their seat is physically released, which normally
 * happens when someone applies to the same match. Only when the pool looks exhausted are lapsed
 * holds of any match released (bounded, skipping rows others hold), so the hot path stays a
 * single draw.
 */
async function allocateReferenceCode(
  tx: DbOrTx,
  now: Date,
  /** Where the receipt files of reclaimed holds go; without it nothing is reclaimed. */
  staleReceipts?: (string | null)[],
): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('payment_reference_codes'))`);
  const first = await drawReferenceCode(tx);
  if (first) return first;
  if (!staleReceipts) throw new Error('No free payment reference code');
  const released = await releaseLapsedSeats(tx, null, now, 500);
  staleReceipts.push(...released.map((r) => r.receiptKey));
  const code = await drawReferenceCode(tx);
  if (!code) throw new Error('No free payment reference code');
  return code;
}

function toPaymentDto(payment: PaymentRow): RegistrationPaymentDto {
  return {
    referenceCode: EXPECTING.includes(payment.status) ? payment.referenceCode : null,
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
  now: Date,
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
      status: effectiveStatus(registration, payment, now),
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
  now: Date = new Date(),
): Promise<RegistrationDto> {
  const row = await loadOne(db, registrationId);
  if (!row) throw notFound('REGISTRATION_NOT_FOUND');
  return (await toRegistrationDtos(db, [row], locale, now))[0] as RegistrationDto;
}

/** A registration as its owner (or an admin) sees it; anyone else gets the same 404 as a missing id. */
export async function getRegistrationForActor(
  db: Db,
  actor: AuthUser,
  registrationId: string,
  locale: LocaleCode,
  now: Date = new Date(),
): Promise<RegistrationDto> {
  const row = await loadOne(db, registrationId);
  if (!row || (actor.role !== 'ADMIN' && row.registration.userId !== actor.id)) {
    throw notFound('REGISTRATION_NOT_FOUND');
  }
  return (await toRegistrationDtos(db, [row], locale, now))[0] as RegistrationDto;
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

/** Removes receipt files after the transaction that dropped their last reference committed. */
async function discardReceipts(storage: ReceiptStorage, keys: readonly (string | null)[]) {
  await Promise.allSettled(
    keys.filter((k): k is string => k !== null).map((k) => storage.delete(k)),
  );
}

export async function applyToMatch(
  db: Db,
  storage: ReceiptStorage,
  user: AuthUser,
  matchId: string,
  now: Date = new Date(),
): Promise<string> {
  const staleReceipts: (string | null)[] = [];

  const registrationId = await db.transaction(async (tx) => {
    // The match row is the lock that serializes seat allocation, so capacity cannot be exceeded.
    const [match] = await tx.select().from(matches).where(eq(matches.id, matchId)).for('update');
    if (!match) throw notFound('MATCH_NOT_FOUND');
    if (match.cancelledAt) throw new AppError('MATCH_CANCELLED', 409);
    if (match.startsAt <= now) throw new AppError('MATCH_STARTED', 409);

    const released = await releaseLapsedSeats(tx, matchId, now);
    staleReceipts.push(...released.map((r) => r.receiptKey));

    const [existing] = await tx
      .select()
      .from(matchRegistrations)
      .where(and(eq(matchRegistrations.matchId, matchId), eq(matchRegistrations.userId, user.id)));
    if (existing && existing.status !== 'CANCELLED') throw new AppError('ALREADY_REGISTERED', 409);

    let previous: PaymentRow | null = null;
    if (existing) {
      [previous = null] = await tx
        .select()
        .from(registrationPayments)
        .where(eq(registrationPayments.registrationId, existing.id));
      // Money is in flight or held: an admin must settle it before the player can re-apply.
      if (
        previous &&
        (previous.status === 'PAYMENT_CONFIRMED' ||
          previous.status === 'PAYMENT_REVIEW' ||
          previous.status === 'REFUND_PENDING')
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

    // The old payment row is about to be replaced. A receipt that backed a refunded payment is
    // bookkeeping evidence: keep the file and note where it is. Any other receipt is just dropped.
    if (previous?.receiptKey) {
      if (previous.status === 'REFUNDED') {
        await recordPaymentEvent(tx, {
          registrationId: registration.id,
          event: 'RECEIPT_ARCHIVED',
          amountKrw: previous.amountKrw,
          detail: { receiptKey: previous.receiptKey },
        });
      } else {
        staleReceipts.push(previous.receiptKey);
      }
    }

    if (free) {
      await tx
        .delete(registrationPayments)
        .where(eq(registrationPayments.registrationId, registration.id));
      await enqueueNotification(tx, {
        userId: user.id,
        type: 'PARTICIPATION_CONFIRMED',
      });
    } else {
      const fresh = {
        amountKrw: match.feeKrw,
        referenceCode: await allocateReferenceCode(tx, now, staleReceipts),
        status: 'AWAITING_PAYMENT',
        dueAt: paymentDeadline(now, match.startsAt),
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
      await recordPaymentEvent(tx, {
        registrationId: registration.id,
        actorId: user.id,
        event: 'PAYMENT_CREATED',
        toStatus: 'AWAITING_PAYMENT',
        amountKrw: match.feeKrw,
      });
    }
    return registration.id;
  });

  await discardReceipts(storage, staleReceipts);
  return registrationId;
}

/** Newest first. Pure read: expired holds are reported as cancelled, never written here. */
export async function listMyRegistrations(
  db: Db,
  user: AuthUser,
  locale: LocaleCode,
  page: { limit: number; offset: number },
  now: Date = new Date(),
): Promise<Page<RegistrationDto>> {
  const rows = await db
    .select({ registration: matchRegistrations, payment: registrationPayments })
    .from(matchRegistrations)
    .leftJoin(registrationPayments, eq(registrationPayments.registrationId, matchRegistrations.id))
    .where(eq(matchRegistrations.userId, user.id))
    .orderBy(desc(matchRegistrations.createdAt), desc(matchRegistrations.id))
    .limit(page.limit)
    .offset(page.offset);
  return {
    items: await toRegistrationDtos(db, rows, locale, now),
    limit: page.limit,
    offset: page.offset,
  };
}

export async function cancelRegistration(
  db: Db,
  storage: ReceiptStorage,
  user: AuthUser,
  registrationId: string,
  now: Date = new Date(),
): Promise<void> {
  const discard: (string | null)[] = [];
  await db.transaction(async (tx) => {
    const { registration, payment } = await lockOwned(tx, user, registrationId);
    if (effectiveStatus(registration, payment, now) === 'CANCELLED') throw invalidState();
    const [match] = await tx.select().from(matches).where(eq(matches.id, registration.matchId));
    if (!match || match.startsAt <= now) throw new AppError('MATCH_STARTED', 409);

    await tx
      .update(matchRegistrations)
      .set({ status: 'CANCELLED', updatedAt: now })
      .where(eq(matchRegistrations.id, registrationId));

    if (payment?.status === 'PAYMENT_REVIEW' || payment?.status === 'PAYMENT_CONFIRMED') {
      // Money may have arrived: it must be settled by an admin, and stays visible to the player.
      await tx
        .update(registrationPayments)
        .set({ status: 'REFUND_PENDING', updatedAt: now })
        .where(eq(registrationPayments.id, payment.id));
      await recordPaymentEvent(tx, {
        registrationId,
        actorId: user.id,
        event: 'REFUND_PENDING',
        fromStatus: payment.status,
        toStatus: 'REFUND_PENDING',
        amountKrw: payment.amountKrw,
      });
    } else if (payment?.status === 'PAYMENT_REJECTED' || payment?.status === 'AWAITING_PAYMENT') {
      // Nothing was paid: drop any rejected receipt and free the reference code.
      discard.push(payment.receiptKey);
      await tx
        .update(registrationPayments)
        .set({ receiptKey: null, receiptContentType: null, referenceCode: null, updatedAt: now })
        .where(eq(registrationPayments.id, payment.id));
    }
  });
  await discardReceipts(storage, discard);
}

/**
 * Stores the receipt and moves the payment to review. The file type is detected from its bytes;
 * anything that is not a JPEG, PNG or PDF is rejected.
 *
 * The file is written BEFORE the transaction so slow storage never holds a row lock or a pooled
 * connection; if the transaction fails the new file is removed again.
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

  const newKey = await storage.put(bytes, type);
  let replaced: string | null = null;
  try {
    await db.transaction(async (tx) => {
      const { registration, payment } = await lockOwned(tx, user, registrationId);
      if (!payment || registration.status !== 'APPLIED') throw invalidState();
      if (payment.status !== 'AWAITING_PAYMENT' && payment.status !== 'PAYMENT_REJECTED') {
        throw invalidState();
      }
      if (payment.dueAt < now) throw invalidState();
      replaced = payment.receiptKey;
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
      await recordPaymentEvent(tx, {
        registrationId,
        actorId: user.id,
        event: 'RECEIPT_UPLOADED',
        fromStatus: payment.status,
        toStatus: 'PAYMENT_REVIEW',
        amountKrw: payment.amountKrw,
      });
    });
  } catch (error) {
    await discardReceipts(storage, [newKey]);
    throw error;
  }
  await discardReceipts(storage, [replaced]);
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
  now: Date = new Date(),
): Promise<Page<AdminPaymentDto>> {
  const rows = await db
    .select({ registration: matchRegistrations, payment: registrationPayments, user: users })
    .from(registrationPayments)
    .innerJoin(matchRegistrations, eq(matchRegistrations.id, registrationPayments.registrationId))
    .innerJoin(users, eq(users.id, matchRegistrations.userId))
    .where(eq(registrationPayments.status, filter.status))
    // Oldest first: people have been waiting longest.
    .orderBy(
      asc(registrationPayments.receiptUploadedAt),
      asc(registrationPayments.createdAt),
      asc(registrationPayments.id),
    )
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
        registrationStatus: effectiveStatus(r.registration, r.payment, now),
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

/** Moves a payment between statuses, failing if it changed underneath us. */
async function movePayment(
  tx: DbOrTx,
  payment: PaymentRow,
  to: PaymentStatus,
  actorId: string | null,
  now: Date,
  extra: Partial<typeof registrationPayments.$inferInsert> = {},
): Promise<void> {
  const updated = await tx
    .update(registrationPayments)
    .set({ status: to, reviewedBy: actorId, reviewedAt: now, updatedAt: now, ...extra })
    .where(
      and(eq(registrationPayments.id, payment.id), eq(registrationPayments.status, payment.status)),
    )
    .returning({ id: registrationPayments.id });
  if (updated.length === 0) throw invalidState();
}

/**
 * Confirms a payment under review and the player's participation, and notifies the player. Used
 * by admins and by automatic bank matching, always inside the caller's transaction so the player
 * is told if and only if the confirmation really happened.
 */
export async function confirmPaymentInTx(
  tx: DbOrTx,
  registrationId: string,
  actor: AuthUser | null,
  now: Date,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const { registration, payment } = await lockReviewable(tx, registrationId);
  // Automatic bank matching may confirm before any receipt exists, or after an earlier rejection
  // when the money turns out to have arrived.
  if (
    payment.status !== 'PAYMENT_REVIEW' &&
    payment.status !== 'AWAITING_PAYMENT' &&
    payment.status !== 'PAYMENT_REJECTED'
  ) {
    throw invalidState();
  }
  if (registration.status !== 'APPLIED') throw invalidState();
  await movePayment(tx, payment, 'PAYMENT_CONFIRMED', actor?.id ?? null, now, {
    rejectReason: null,
  });
  await tx
    .update(matchRegistrations)
    .set({ status: 'CONFIRMED', updatedAt: now })
    .where(eq(matchRegistrations.id, registrationId));
  await recordPaymentEvent(tx, {
    registrationId,
    actorId: actor?.id ?? null,
    event: 'CONFIRMED',
    fromStatus: payment.status,
    toStatus: 'PAYMENT_CONFIRMED',
    amountKrw: payment.amountKrw,
    detail,
  });
  for (const type of ['PAYMENT_CONFIRMED', 'PARTICIPATION_CONFIRMED'] as const) {
    await enqueueNotification(tx, { userId: registration.userId, type });
  }
}

export async function confirmPayment(
  db: Db,
  admin: AuthUser,
  registrationId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    // Admins confirm payments that already have a receipt under review.
    const { payment } = await lockReviewable(tx, registrationId);
    if (payment.status !== 'PAYMENT_REVIEW') throw invalidState();
    await confirmPaymentInTx(tx, registrationId, admin, now, { via: 'ADMIN' });
  });
}

/**
 * True when a bank deposit settled this payment since it was last (re)created, so the money is in
 * the account and "close without refund" would silently keep it.
 */
async function hasMatchedDeposit(tx: DbOrTx, registrationId: string): Promise<boolean> {
  const result = await tx.execute(sql`
    select 1 from payment_events d
     where d.registration_id = ${registrationId}
       and d.event = 'DEPOSIT_MATCHED'
       and d.created_at > coalesce((
         select max(c.created_at) from payment_events c
          where c.registration_id = d.registration_id
            and (c.event = 'PAYMENT_CREATED'
                 or (c.event = 'REJECTED' and c.detail ->> 'revoked' = 'true'))), '-infinity')
     limit 1`);
  return result.rows.length > 0;
}

/**
 * Admin rejection. Besides sending a receipt back (PAYMENT_REVIEW) and closing a cancelled,
 * unpaid registration (REFUND_PENDING), it revokes a CONFIRMED payment, e.g. one a bank alert
 * confirmed for the wrong person: the registration returns to APPLIED with a fresh code and
 * deadline, and a bank deposit that confirmed it goes back to the admin queue.
 */
export async function rejectPayment(
  db: Db,
  admin: AuthUser,
  registrationId: string,
  reason: PaymentRejectReason,
  now: Date = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    // Lock order matches assignDeposit (deposit first, then registration).
    const [peek] = await tx
      .select({ status: registrationPayments.status })
      .from(registrationPayments)
      .where(eq(registrationPayments.registrationId, registrationId));
    const linked =
      peek?.status === 'PAYMENT_CONFIRMED'
        ? await tx
            .select({ id: bankDeposits.id })
            .from(bankDeposits)
            .where(
              and(
                eq(bankDeposits.matchedRegistrationId, registrationId),
                eq(bankDeposits.status, 'MATCHED'),
              ),
            )
            .orderBy(asc(bankDeposits.id))
            .for('update')
        : [];

    const { registration, payment } = await lockReviewable(tx, registrationId);
    const [match] = await tx.select().from(matches).where(eq(matches.id, registration.matchId));
    if (!match) throw new Error('Registration references a missing match');
    let detail: Record<string, unknown> = { reason };

    if (payment.status === 'REFUND_PENDING') {
      // Cancelled registration: close it out. The player was already told they cancelled, so
      // there is nothing to ask them to re-upload. Money that a deposit settled must be refunded.
      if (await hasMatchedDeposit(tx, registrationId)) throw invalidState();
      await movePayment(tx, payment, 'PAYMENT_REJECTED', admin.id, now, {
        rejectReason: reason,
        referenceCode: null,
      });
    } else if (payment.status === 'PAYMENT_REVIEW' && registration.status === 'APPLIED') {
      await movePayment(tx, payment, 'PAYMENT_REJECTED', admin.id, now, {
        rejectReason: reason,
        // A review that took longer than the original window must not cost the player the seat.
        dueAt: paymentDeadline(now, match.startsAt),
      });
      await enqueueNotification(tx, {
        userId: registration.userId,
        type: 'PAYMENT_REJECTED',
        localizedParams: { reason: `payment.rejectReason.${reason}` },
      });
    } else if (payment.status === 'PAYMENT_CONFIRMED' && registration.status === 'CONFIRMED') {
      if (match.startsAt <= now) throw new AppError('MATCH_STARTED', 409);
      if (registration.attendanceMarkedAt !== null) throw invalidState();
      await movePayment(tx, payment, 'PAYMENT_REJECTED', admin.id, now, {
        rejectReason: reason,
        referenceCode: await allocateReferenceCode(tx, now),
        dueAt: paymentDeadline(now, match.startsAt),
      });
      await tx
        .update(matchRegistrations)
        .set({ status: 'APPLIED', updatedAt: now })
        .where(eq(matchRegistrations.id, registrationId));
      if (linked.length > 0) {
        await tx
          .update(bankDeposits)
          .set({
            status: 'UNMATCHED',
            matchMethod: null,
            reason: 'STATE_CHANGED',
            matchedRegistrationId: null,
            resolvedBy: null,
            processedAt: now,
          })
          .where(
            inArray(
              bankDeposits.id,
              linked.map((d) => d.id),
            ),
          );
        // The name may have been "proven" by this very (wrong) deposit.
        await tx
          .update(users)
          .set({ depositorNameVerified: false, updatedAt: now })
          .where(eq(users.id, registration.userId));
      }
      await enqueueNotification(tx, {
        userId: registration.userId,
        type: 'PAYMENT_REJECTED',
        localizedParams: { reason: `payment.rejectReason.${reason}` },
      });
      detail = { reason, revoked: true, depositIds: linked.map((d) => d.id) };
    } else {
      throw invalidState();
    }
    await recordPaymentEvent(tx, {
      registrationId,
      actorId: admin.id,
      event: 'REJECTED',
      fromStatus: payment.status,
      toStatus: 'PAYMENT_REJECTED',
      amountKrw: payment.amountKrw,
      detail,
    });
  });
}

/** Marks money as returned. Only valid once a cancelled registration's payment awaits refund. */
export async function refundPayment(
  db: Db,
  admin: AuthUser,
  registrationId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const { registration, payment } = await lockReviewable(tx, registrationId);
    if (payment.status !== 'REFUND_PENDING' || registration.status !== 'CANCELLED') {
      throw invalidState();
    }
    await movePayment(tx, payment, 'REFUNDED', admin.id, now);
    await recordPaymentEvent(tx, {
      registrationId,
      actorId: admin.id,
      event: 'REFUNDED',
      fromStatus: 'REFUND_PENDING',
      toStatus: 'REFUNDED',
      amountKrw: payment.amountKrw,
    });
    await enqueueNotification(tx, {
      userId: registration.userId,
      type: 'PAYMENT_REFUNDED',
    });
  });
}

export async function getAdminPayment(
  db: Db,
  locale: LocaleCode,
  registrationId: string,
  now: Date = new Date(),
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
    registrationStatus: effectiveStatus(row.registration, row.payment, now),
    payment: toPaymentDto(row.payment),
    receiptUploadedAt: row.payment.receiptUploadedAt?.toISOString() ?? null,
  };
}
