import type { ErrorCode } from '@foodboll/contracts';

export interface ErrorDetail {
  readonly path: string;
  readonly issue: string;
}

/** A failure the client can act on. Anything else is an unexpected 500. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    readonly details?: readonly ErrorDetail[],
  ) {
    super(code);
    this.name = 'AppError';
  }
}

export const unauthenticated = () => new AppError('UNAUTHENTICATED', 401);
export const forbidden = () => new AppError('FORBIDDEN', 403);
export const notFound = (code: ErrorCode = 'NOT_FOUND') => new AppError(code, 404);
