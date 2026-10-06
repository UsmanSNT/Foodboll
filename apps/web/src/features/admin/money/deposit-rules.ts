import type { BankDepositDto } from '@foodboll/contracts';

export type AssignableDeposit = BankDepositDto & { readonly amountKrw: number };

/**
 * A deposit can be tied to a registration while it is not matched yet (an ignored one included,
 * in case it was ignored by mistake), and only when its amount is known: the server accepts
 * nothing but an exact amount.
 */
export function isAssignable(deposit: BankDepositDto): deposit is AssignableDeposit {
  return deposit.amountKrw !== null && deposit.status !== 'MATCHED';
}

/** Only deposits still waiting for a decision can be ignored. */
export function isIgnorable(deposit: BankDepositDto): boolean {
  return deposit.status === 'UNMATCHED' || deposit.status === 'AMBIGUOUS';
}
