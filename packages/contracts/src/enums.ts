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
  'REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABEL_KEY = {
  AWAITING_PAYMENT: 'payment.awaiting',
  PAYMENT_REVIEW: 'payment.pending',
  PAYMENT_CONFIRMED: 'payment.paid',
  PAYMENT_REJECTED: 'payment.rejected',
  REFUNDED: 'payment.refunded',
} as const satisfies Record<PaymentStatus, MessageKey>;

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

export const NOTIFICATION_TYPES = ['PAYMENT_CONFIRMED', 'PARTICIPATION_CONFIRMED'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_MESSAGE_KEYS = {
  PAYMENT_CONFIRMED: {
    title: 'notification.paymentConfirmed.title',
    body: 'notification.paymentConfirmed.body',
  },
  PARTICIPATION_CONFIRMED: {
    title: 'notification.participationConfirmed.title',
    body: 'notification.participationConfirmed.body',
  },
} as const satisfies Record<NotificationType, { title: MessageKey; body: MessageKey }>;

export const NOTIFICATION_CHANNELS = ['PUSH', 'EMAIL', 'SMS'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
