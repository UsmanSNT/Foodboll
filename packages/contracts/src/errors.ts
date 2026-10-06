import type { MessageKey } from '@foodboll/i18n';

export const ERROR_CODES = [
  'INTERNAL_ERROR',
  'NETWORK_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'VALIDATION_FAILED',
  'RATE_LIMITED',
  'NOT_FOUND',
  'LANGUAGE_NOT_SUPPORTED',
  'SOURCE_TRANSLATION_REQUIRED',
  'MATCH_NOT_FOUND',
  'PAYMENT_INSTRUCTIONS_NOT_FOUND',
  'LEGAL_DOCUMENT_NOT_FOUND',
  'PAYLOAD_TOO_LARGE',
  'REGISTRATION_NOT_FOUND',
  'RECEIPT_NOT_FOUND',
  'ALREADY_REGISTERED',
  'MATCH_FULL',
  'MATCH_STARTED',
  'INVALID_STATE',
  'INVALID_RECEIPT',
  'CAPACITY_BELOW_REGISTRATIONS',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Compile-time guarantee that every error code has a catalog message. */
export function errorMessageKey(code: ErrorCode): MessageKey {
  return `errors.${code}`;
}

export interface ApiErrorBody {
  readonly error: {
    /** Stable, machine-readable. Clients should localize from this, not from `message`. */
    readonly code: ErrorCode;
    /** Already localized to the request language; a convenience for simple clients. */
    readonly message: string;
    readonly details?: readonly { readonly path: string; readonly issue: string }[];
  };
}
