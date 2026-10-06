import type {
  BankDepositReason,
  BankDepositSource,
  BankDepositStatus,
  BankMatchMethod,
  PaymentStatus,
} from '@foodboll/contracts';
import type { MessageKey } from '@foodboll/i18n';
import type { Tone } from '../../../ui/Badge';
import type { DepositTab } from './api';

// Database values are never shown: every one maps to a catalog key (or a badge colour) here.

/** Tab order on the payment screen: the queues that need a person come first. */
export const PAYMENT_TABS = [
  'PAYMENT_REVIEW',
  'REFUND_PENDING',
  'AWAITING_PAYMENT',
  'PAYMENT_REJECTED',
  'REFUNDED',
  'PAYMENT_CONFIRMED',
] as const satisfies readonly PaymentStatus[];

export const PAYMENT_TAB_LABEL_KEY = {
  PAYMENT_REVIEW: 'adminPayments.tab.PAYMENT_REVIEW',
  REFUND_PENDING: 'adminPayments.tab.REFUND_PENDING',
  AWAITING_PAYMENT: 'adminPayments.tab.AWAITING_PAYMENT',
  PAYMENT_REJECTED: 'adminPayments.tab.PAYMENT_REJECTED',
  REFUNDED: 'adminPayments.tab.REFUNDED',
  PAYMENT_CONFIRMED: 'adminPayments.tab.PAYMENT_CONFIRMED',
} as const satisfies Record<PaymentStatus, MessageKey>;

export const PAYMENT_HINT_KEY = {
  PAYMENT_REVIEW: 'adminPayments.hint.PAYMENT_REVIEW',
  REFUND_PENDING: 'adminPayments.hint.REFUND_PENDING',
  AWAITING_PAYMENT: 'adminPayments.hint.AWAITING_PAYMENT',
  PAYMENT_REJECTED: 'adminPayments.hint.PAYMENT_REJECTED',
  REFUNDED: 'adminPayments.hint.REFUNDED',
  PAYMENT_CONFIRMED: 'adminPayments.hint.PAYMENT_CONFIRMED',
} as const satisfies Record<PaymentStatus, MessageKey>;

export const PAYMENT_EMPTY_KEY = {
  PAYMENT_REVIEW: 'adminPayments.emptyTitle.PAYMENT_REVIEW',
  REFUND_PENDING: 'adminPayments.emptyTitle.REFUND_PENDING',
  AWAITING_PAYMENT: 'adminPayments.emptyTitle.AWAITING_PAYMENT',
  PAYMENT_REJECTED: 'adminPayments.emptyTitle.PAYMENT_REJECTED',
  REFUNDED: 'adminPayments.emptyTitle.REFUNDED',
  PAYMENT_CONFIRMED: 'adminPayments.emptyTitle.PAYMENT_CONFIRMED',
} as const satisfies Record<PaymentStatus, MessageKey>;

export const DEPOSIT_TABS = [
  'needs',
  'matched',
  'ignored',
] as const satisfies readonly DepositTab[];

export const DEPOSIT_TAB_LABEL_KEY = {
  needs: 'adminDeposits.tabs.needs',
  matched: 'adminDeposits.tabs.matched',
  ignored: 'adminDeposits.tabs.ignored',
} as const satisfies Record<DepositTab, MessageKey>;

export const DEPOSIT_HINT_KEY = {
  needs: 'adminDeposits.hint.needs',
  matched: 'adminDeposits.hint.matched',
  ignored: 'adminDeposits.hint.ignored',
} as const satisfies Record<DepositTab, MessageKey>;

export const DEPOSIT_EMPTY_KEY = {
  needs: 'adminDeposits.emptyTitle.needs',
  matched: 'adminDeposits.emptyTitle.matched',
  ignored: 'adminDeposits.emptyTitle.ignored',
} as const satisfies Record<DepositTab, MessageKey>;

export const DEPOSIT_STATUS_LABEL_KEY = {
  UNMATCHED: 'adminDeposits.status.UNMATCHED',
  AMBIGUOUS: 'adminDeposits.status.AMBIGUOUS',
  MATCHED: 'adminDeposits.status.MATCHED',
  IGNORED: 'adminDeposits.status.IGNORED',
} as const satisfies Record<BankDepositStatus, MessageKey>;

export const DEPOSIT_STATUS_TONE = {
  UNMATCHED: 'warning',
  AMBIGUOUS: 'info',
  MATCHED: 'success',
  IGNORED: 'neutral',
} as const satisfies Record<BankDepositStatus, Tone>;

export const DEPOSIT_SOURCE_LABEL_KEY = {
  WEBHOOK: 'adminDeposits.source.WEBHOOK',
  TELEGRAM: 'adminDeposits.source.TELEGRAM',
} as const satisfies Record<BankDepositSource, MessageKey>;

export const DEPOSIT_REASON_LABEL_KEY = {
  AMOUNT_MISMATCH: 'adminDeposits.reason.AMOUNT_MISMATCH',
  NO_CANDIDATE: 'adminDeposits.reason.NO_CANDIDATE',
  MULTIPLE_CANDIDATES: 'adminDeposits.reason.MULTIPLE_CANDIDATES',
  STALE_MESSAGE: 'adminDeposits.reason.STALE_MESSAGE',
  RATE_GUARD: 'adminDeposits.reason.RATE_GUARD',
  STATE_CHANGED: 'adminDeposits.reason.STATE_CHANGED',
  NOT_PARSED: 'adminDeposits.reason.NOT_PARSED',
  MANUAL: 'adminDeposits.reason.MANUAL',
} as const satisfies Record<BankDepositReason, MessageKey>;

export const DEPOSIT_METHOD_LABEL_KEY = {
  REFERENCE: 'adminDeposits.method.REFERENCE',
  NAME: 'adminDeposits.method.NAME',
  MANUAL: 'adminDeposits.method.MANUAL',
} as const satisfies Record<BankMatchMethod, MessageKey>;
