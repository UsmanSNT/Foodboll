import type { AdminPaymentDto } from '@foodboll/contracts';

const fold = (text: string) => text.normalize('NFC').trim().toLocaleLowerCase();

export interface CandidateFilter {
  /** The deposit's amount; only registrations owing exactly this are kept when `sameAmountOnly`. */
  readonly amountKrw: number | null;
  readonly sameAmountOnly: boolean;
  readonly query: string;
}

/**
 * The registrations an admin can pick for a deposit. Live registrations come first, then the most
 * recently due: the player who just paid is almost always the one who registered last.
 */
export function filterCandidates(items: readonly AdminPaymentDto[], filter: CandidateFilter): AdminPaymentDto[] {
  const query = fold(filter.query);
  return items
    .filter((item) => !filter.sameAmountOnly || item.payment.amountKrw === filter.amountKrw)
    .filter(
      (item) =>
        query === '' ||
        fold(item.user.displayName).includes(query) ||
        (item.payment.referenceCode ?? '').includes(query),
    )
    .sort(
      (a, b) =>
        Number(a.registrationStatus === 'CANCELLED') - Number(b.registrationStatus === 'CANCELLED') ||
        b.payment.dueAt.localeCompare(a.payment.dueAt),
    );
}
