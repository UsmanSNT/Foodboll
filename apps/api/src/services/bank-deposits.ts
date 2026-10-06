import type {
  BankDepositDto,
  BankDepositReason,
  BankDepositSource,
  BankDepositStatus,
  BankMatchMethod,
  Page,
} from '@foodboll/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { AuthUser } from '../context';
import type { BankConfig } from '../config';
import type { Db, DbOrTx } from '../db/client';
import { bankDeposits, matchRegistrations, registrationPayments, users } from '../db/schema';
import { AppError, notFound } from '../errors';
import {
  containsName,
  containsReference,
  normalizeMessage,
  parseBankMessage,
  type ParsedDeposit,
} from '../banking/parse-bank-message';
import { recordPaymentEvent } from './payment-audit';
import { confirmPaymentInTx } from './registrations';

const KST_OFFSET_MS = 9 * 3600 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const HOUR_MS = 3600 * 1000;
const EXPECTING_PAYMENT = ['AWAITING_PAYMENT', 'PAYMENT_REVIEW', 'PAYMENT_REJECTED'] as const;

export interface IngestInput {
  readonly source: BankDepositSource;
  readonly text: string;
  /** When the phone / Telegram received the message. */
  readonly receivedAt: Date;
  /** Provider's own id for the message, if it has one (makes redelivery a no-op). */
  readonly externalId?: string | null | undefined;
}

export interface IngestResult {
  /** Null when the message was not about a deposit at all and was dropped without a trace. */
  readonly depositId: string | null;
  readonly status: BankDepositStatus | 'DROPPED';
  readonly reason: BankDepositReason | null;
  /** True when this exact message had been processed before. */
  readonly duplicate: boolean;
}

interface Decision {
  readonly status: BankDepositStatus;
  readonly method?: BankMatchMethod;
  readonly reason?: BankDepositReason;
  readonly registrationId?: string;
}

/**
 * The time printed in a bank message, as an instant. Banks print month/day/hour/minute in Korean
 * time without a year, so the year is inferred from when we received it.
 */
function printedInstant(at: NonNullable<ParsedDeposit['occurredAt']>, receivedAt: Date): Date {
  const kstYear = new Date(receivedAt.getTime() + KST_OFFSET_MS).getUTCFullYear();
  const at_ = (year: number) =>
    new Date(Date.UTC(year, at.month - 1, at.day, at.hour, at.minute) - KST_OFFSET_MS);
  const candidate = at_(kstYear);
  // A December message received in early January belongs to the previous year.
  return candidate.getTime() - receivedAt.getTime() > 24 * HOUR_MS ? at_(kstYear - 1) : candidate;
}

/** A message is only trusted if it is recent: old SMS can be re-forwarded or replayed. */
function isStale(parsed: ParsedDeposit, input: IngestInput, bank: BankConfig, now: Date): boolean {
  const maxAge = bank.maxMessageAgeHours * HOUR_MS;
  if (now.getTime() - input.receivedAt.getTime() > maxAge) return true;
  if (input.receivedAt.getTime() - now.getTime() > 10 * 60 * 1000) return true; // from the future
  if (!parsed.occurredAt) return false;
  const age =
    input.receivedAt.getTime() - printedInstant(parsed.occurredAt, input.receivedAt).getTime();
  return age > maxAge || age < -10 * 60 * 1000;
}

async function recentAutoConfirmations(db: DbOrTx, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bankDeposits)
    .where(
      and(
        eq(bankDeposits.status, 'MATCHED'),
        sql`${bankDeposits.matchMethod} <> 'MANUAL'`,
        gte(bankDeposits.processedAt, new Date(now.getTime() - TEN_MINUTES_MS)),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Decides which payment (if any) a deposit settles. Confirms only when exactly one payment fits,
 * the amount is exact, and the registration is still live; everything else goes to a human.
 */
async function decide(
  tx: DbOrTx,
  parsed: ParsedDeposit,
  input: IngestInput,
  bank: BankConfig,
  now: Date,
): Promise<Decision> {
  if (isStale(parsed, input, bank, now)) return { status: 'UNMATCHED', reason: 'STALE_MESSAGE' };

  // Payments still expected, inside their window, for registrations that are still live.
  const expecting = await tx
    .select({
      registrationId: matchRegistrations.id,
      amountKrw: registrationPayments.amountKrw,
      referenceCode: registrationPayments.referenceCode,
      depositorName: users.depositorName,
    })
    .from(registrationPayments)
    .innerJoin(matchRegistrations, eq(matchRegistrations.id, registrationPayments.registrationId))
    .innerJoin(users, eq(users.id, matchRegistrations.userId))
    .where(
      and(
        inArray(registrationPayments.status, [...EXPECTING_PAYMENT]),
        eq(matchRegistrations.status, 'APPLIED'),
        gte(registrationPayments.dueAt, now),
      ),
    );

  const byReference = expecting.filter(
    (p) => p.referenceCode !== null && containsReference(parsed.residual, p.referenceCode),
  );
  let chosen: (typeof expecting)[number] | undefined;
  let method: BankMatchMethod = 'REFERENCE';

  if (byReference.length > 1) return { status: 'AMBIGUOUS', reason: 'MULTIPLE_CANDIDATES' };
  if (byReference.length === 1) {
    chosen = byReference[0];
  } else {
    const sameAmount = expecting.filter((p) => p.amountKrw === parsed.amountKrw);
    const byName = sameAmount.filter(
      (p) => p.depositorName !== null && containsName(parsed.residual, p.depositorName),
    );
    if (byName.length > 1) return { status: 'AMBIGUOUS', reason: 'MULTIPLE_CANDIDATES' };
    if (byName.length === 0) {
      return { status: 'UNMATCHED', reason: sameAmount.length ? 'NO_CANDIDATE' : 'NO_CANDIDATE' };
    }
    chosen = byName[0];
    method = 'NAME';
  }
  if (!chosen) return { status: 'UNMATCHED', reason: 'NO_CANDIDATE' };
  if (chosen.amountKrw !== parsed.amountKrw)
    return { status: 'UNMATCHED', reason: 'AMOUNT_MISMATCH' };
  if ((await recentAutoConfirmations(tx, now)) >= bank.autoConfirmLimitPer10Min) {
    return { status: 'AMBIGUOUS', reason: 'RATE_GUARD' };
  }
  return { status: 'MATCHED', method, registrationId: chosen.registrationId };
}

/**
 * Takes one bank message through parsing and matching in a single transaction, so a deposit is
 * recorded as MATCHED if and only if its payment was really confirmed (and the player notified).
 * Idempotent: the same message delivered twice is processed once.
 */
export async function ingestBankMessage(
  db: Db,
  bank: BankConfig,
  input: IngestInput,
  now: Date = new Date(),
): Promise<IngestResult> {
  const normalized = normalizeMessage(input.text);
  // Unrelated texts (parcels, ads, codes) are dropped without being stored.
  if (!normalized.includes('입금')) {
    return { depositId: null, status: 'DROPPED', reason: null, duplicate: false };
  }
  const bucket =
    input.externalId ?? String(Math.floor(input.receivedAt.getTime() / TEN_MINUTES_MS));
  const dedupeKey = `${createHash('sha256').update(`${input.source}\n${normalized}`).digest('hex')}:${bucket}`;

  return db.transaction(async (tx) => {
    // Serialize concurrent deliveries of the same message (forwarder retries).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${dedupeKey}))`);
    const [existing] = await tx
      .select()
      .from(bankDeposits)
      .where(eq(bankDeposits.dedupeKey, dedupeKey));
    if (existing) {
      return {
        depositId: existing.id,
        status: existing.status as BankDepositStatus,
        reason: existing.reason as BankDepositReason | null,
        duplicate: true,
      };
    }

    const parsed = parseBankMessage(normalized);
    const depositId = randomUUID();
    let decision: Decision;
    if (parsed.kind === 'IGNORED') {
      decision = { status: 'IGNORED', reason: 'NOT_PARSED' };
    } else {
      decision = await decide(tx, parsed, input, bank, now);
      if (decision.status === 'MATCHED' && decision.registrationId) {
        try {
          await confirmPaymentInTx(tx, decision.registrationId, null, now, {
            via: 'BANK_DEPOSIT',
            method: decision.method,
            depositId,
          });
          await recordPaymentEvent(tx, {
            registrationId: decision.registrationId,
            event: 'DEPOSIT_MATCHED',
            amountKrw: parsed.amountKrw,
            detail: { depositId, method: decision.method },
          });
        } catch (error) {
          // The payment changed under us (cancelled, confirmed by an admin...): leave it to a human.
          if (!(error instanceof AppError)) throw error;
          decision = { status: 'UNMATCHED', reason: 'STATE_CHANGED' };
        }
      }
    }

    await tx.insert(bankDeposits).values({
      id: depositId,
      source: input.source,
      dedupeKey,
      rawText: normalized,
      amountKrw: parsed.kind === 'DEPOSIT' ? parsed.amountKrw : null,
      status: decision.status,
      matchMethod: decision.method ?? null,
      reason: decision.reason ?? null,
      matchedRegistrationId: decision.registrationId ?? null,
      receivedAt: input.receivedAt,
      processedAt: now,
    });
    return {
      depositId,
      status: decision.status,
      reason: decision.reason ?? null,
      duplicate: false,
    };
  });
}

// ---- Admin ---------------------------------------------------------------------------------

function toDto(row: typeof bankDeposits.$inferSelect): BankDepositDto {
  return {
    id: row.id,
    source: row.source as BankDepositSource,
    status: row.status as BankDepositStatus,
    matchMethod: row.matchMethod as BankMatchMethod | null,
    reason: row.reason as BankDepositReason | null,
    amountKrw: row.amountKrw,
    receivedAt: row.receivedAt.toISOString(),
    rawText: row.rawText,
    matchedRegistrationId: row.matchedRegistrationId,
  };
}

export async function listBankDeposits(
  db: Db,
  filter: { status: BankDepositStatus; limit: number; offset: number },
): Promise<Page<BankDepositDto>> {
  const rows = await db
    .select()
    .from(bankDeposits)
    .where(eq(bankDeposits.status, filter.status))
    .orderBy(desc(bankDeposits.receivedAt), desc(bankDeposits.id))
    .limit(filter.limit)
    .offset(filter.offset);
  return { items: rows.map(toDto), limit: filter.limit, offset: filter.offset };
}

async function lockUnresolved(tx: DbOrTx, depositId: string) {
  const [row] = await tx
    .select()
    .from(bankDeposits)
    .where(eq(bankDeposits.id, depositId))
    .for('update');
  if (!row) throw notFound();
  if (row.status !== 'UNMATCHED' && row.status !== 'AMBIGUOUS' && row.status !== 'IGNORED') {
    throw new AppError('INVALID_STATE', 409);
  }
  return row;
}

/** An admin ties a deposit the system could not place to a registration, confirming its payment. */
export async function assignDeposit(
  db: Db,
  admin: AuthUser,
  depositId: string,
  registrationId: string,
  now: Date = new Date(),
): Promise<BankDepositDto> {
  return db.transaction(async (tx) => {
    const deposit = await lockUnresolved(tx, depositId);
    const [payment] = await tx
      .select()
      .from(registrationPayments)
      .where(eq(registrationPayments.registrationId, registrationId));
    // The money received must equal what was due; otherwise it is a refund/top-up for a human to settle.
    if (!payment || deposit.amountKrw !== payment.amountKrw)
      throw new AppError('INVALID_STATE', 409);
    await confirmPaymentInTx(tx, registrationId, admin, now, {
      via: 'BANK_DEPOSIT',
      method: 'MANUAL',
      depositId,
    });
    await recordPaymentEvent(tx, {
      registrationId,
      actorId: admin.id,
      event: 'DEPOSIT_MATCHED',
      amountKrw: deposit.amountKrw,
      detail: { depositId, method: 'MANUAL' },
    });
    const [updated] = await tx
      .update(bankDeposits)
      .set({
        status: 'MATCHED',
        matchMethod: 'MANUAL',
        reason: null,
        matchedRegistrationId: registrationId,
        resolvedBy: admin.id,
        processedAt: now,
      })
      .where(eq(bankDeposits.id, depositId))
      .returning();
    if (!updated) throw new Error('Deposit update returned no row');
    return toDto(updated);
  });
}

/** Marks a deposit as not relevant to any payment (e.g. a personal transfer). */
export async function ignoreDeposit(
  db: Db,
  admin: AuthUser,
  depositId: string,
): Promise<BankDepositDto> {
  return db.transaction(async (tx) => {
    await lockUnresolved(tx, depositId);
    const [updated] = await tx
      .update(bankDeposits)
      .set({ status: 'IGNORED', reason: 'MANUAL', resolvedBy: admin.id })
      .where(eq(bankDeposits.id, depositId))
      .returning();
    if (!updated) throw new Error('Deposit update returned no row');
    return toDto(updated);
  });
}
