import type { MessageKey } from '@foodboll/i18n';

/**
 * Technical values stored in the database and sent over the API. They are NEVER shown to users
 * and never translated; the maps below turn them into catalog keys at render time.
 */

export const USER_ROLES = ['PLAYER', 'ORGANIZER', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const PAYMENT_STATUSES = [
  'AWAITING_PAYMENT',
  'PAYMENT_REVIEW',
  'PAYMENT_CONFIRMED',
  'PAYMENT_REJECTED',
  'REFUND_PENDING',
  'REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABEL_KEY = {
  AWAITING_PAYMENT: 'payment.awaiting',
  PAYMENT_REVIEW: 'payment.pending',
  PAYMENT_CONFIRMED: 'payment.paid',
  PAYMENT_REJECTED: 'payment.rejected',
  REFUND_PENDING: 'payment.refundPending',
  REFUNDED: 'payment.refunded',
} as const satisfies Record<PaymentStatus, MessageKey>;

export const PAYMENT_EVENT_TYPES = [
  'PAYMENT_CREATED',
  'RECEIPT_UPLOADED',
  'CONFIRMED',
  'REJECTED',
  'REFUND_PENDING',
  'REFUNDED',
  'EXPIRED',
  'RECEIPT_ARCHIVED',
] as const;
export type PaymentEventType = (typeof PAYMENT_EVENT_TYPES)[number];

export const REGISTRATION_STATUSES = ['APPLIED', 'CONFIRMED', 'CANCELLED'] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const REGISTRATION_STATUS_LABEL_KEY = {
  APPLIED: 'match.applied',
  CONFIRMED: 'match.confirmed',
  CANCELLED: 'match.cancelled',
} as const satisfies Record<RegistrationStatus, MessageKey>;

export const LEGAL_DOCUMENT_TYPES = ['TERMS', 'PRIVACY', 'CANCELLATION', 'REFUND'] as const;
export type LegalDocumentType = (typeof LEGAL_DOCUMENT_TYPES)[number];

export const LEGAL_DOCUMENT_LABEL_KEY = {
  TERMS: 'legal.terms',
  PRIVACY: 'legal.privacy',
  CANCELLATION: 'legal.cancellation',
  REFUND: 'legal.refund',
} as const satisfies Record<LegalDocumentType, MessageKey>;

export const PAYMENT_REJECT_REASONS = [
  'AMOUNT_MISMATCH',
  'RECEIPT_UNREADABLE',
  'PAYMENT_NOT_FOUND',
  'OTHER',
] as const;
export type PaymentRejectReason = (typeof PAYMENT_REJECT_REASONS)[number];

/** Rejection reasons are codes, not free text, so every user reads them in their own language. */
export const PAYMENT_REJECT_REASON_LABEL_KEY = {
  AMOUNT_MISMATCH: 'payment.rejectReason.AMOUNT_MISMATCH',
  RECEIPT_UNREADABLE: 'payment.rejectReason.RECEIPT_UNREADABLE',
  PAYMENT_NOT_FOUND: 'payment.rejectReason.PAYMENT_NOT_FOUND',
  OTHER: 'payment.rejectReason.OTHER',
} as const satisfies Record<PaymentRejectReason, MessageKey>;

export const IDENTITY_PROVIDERS = ['TELEGRAM', 'DEV'] as const;
export type IdentityProvider = (typeof IDENTITY_PROVIDERS)[number];

export const NOTIFICATION_TYPES = [
  'PAYMENT_CONFIRMED',
  'PAYMENT_REJECTED',
  'PAYMENT_REFUNDED',
  'PARTICIPATION_CONFIRMED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_MESSAGE_KEYS = {
  PAYMENT_CONFIRMED: {
    title: 'notification.paymentConfirmed.title',
    body: 'notification.paymentConfirmed.body',
  },
  PAYMENT_REJECTED: {
    title: 'notification.paymentRejected.title',
    body: 'notification.paymentRejected.body',
  },
  PAYMENT_REFUNDED: {
    title: 'notification.paymentRefunded.title',
    body: 'notification.paymentRefunded.body',
  },
  PARTICIPATION_CONFIRMED: {
    title: 'notification.participationConfirmed.title',
    body: 'notification.participationConfirmed.body',
  },
} as const satisfies Record<NotificationType, { title: MessageKey; body: MessageKey }>;

/** In-app inbox (always) and Telegram (once the user has pressed Start in the bot). */
export const NOTIFICATION_CHANNELS = ['IN_APP', 'TELEGRAM'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
