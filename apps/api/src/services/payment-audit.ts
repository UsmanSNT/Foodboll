import type { PaymentEventType } from '@foodboll/contracts';
import type { DbOrTx } from '../db/client';
import { paymentEvents } from '../db/schema';

export interface PaymentEventInput {
  readonly registrationId: string;
  /** Null for system actions (expiry, automatic bank matching). */
  readonly actorId?: string | null;
  readonly event: PaymentEventType;
  readonly fromStatus?: string | null;
  readonly toStatus?: string | null;
  readonly amountKrw?: number | null;
  readonly detail?: Record<string, unknown>;
}

/** Appends to the immutable audit trail. Always call inside the transaction that changes state. */
export async function recordPaymentEvent(db: DbOrTx, input: PaymentEventInput): Promise<void> {
  await db.insert(paymentEvents).values({
    registrationId: input.registrationId,
    actorId: input.actorId ?? null,
    event: input.event,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    amountKrw: input.amountKrw ?? null,
    detail: input.detail ?? {},
  });
}
