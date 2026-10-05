import type { ApiErrorBody, ErrorCode } from '@foodboll/contracts';
import type { LocaleCode } from '@foodboll/i18n';
import { readAccessToken } from '../i18n/storage';

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    /** Already localized by the server for the request language. */
    readonly serverMessage?: string,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

interface RequestOptions {
  readonly method?: 'GET' | 'PATCH';
  readonly body?: unknown;
  /** Language the server should render content in. */
  readonly locale?: LocaleCode;
  readonly signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`, window.location.origin);
  if (options.locale) url.searchParams.set('lang', options.locale);

  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = readAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
      ...(options.signal && { signal: options.signal }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('NETWORK_ERROR', 0);
  }

  if (!response.ok) {
    const parsed = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      parsed?.error.code ?? 'INTERNAL_ERROR',
      response.status,
      parsed?.error.message,
    );
  }
  return (await response.json()) as T;
}
