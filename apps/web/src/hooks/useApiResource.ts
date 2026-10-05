import { useCallback, useEffect, useState } from 'react';
import { apiRequest, ApiError } from '../api/client';
import { useI18n } from '../i18n/I18nProvider';

type Settled<T> =
  | { readonly status: 'error'; readonly error: ApiError }
  | { readonly status: 'success'; readonly data: T };

export type ResourceState<T> = { readonly status: 'loading' } | Settled<T>;

/**
 * Loads `path` rendered in the user's language. The server picks the right translation (with
 * fallback), so the request is repeated when the language changes.
 */
export function useApiResource<T>(path: string): ResourceState<T> & { reload(): void } {
  const { locale } = useI18n();
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${locale}\u0000${path}\u0000${attempt}`;
  const [settled, setSettled] = useState<{ key: string; result: Settled<T> } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<T>(path, { locale, signal: controller.signal }).then(
      (data) => setSettled({ key: requestKey, result: { status: 'success', data } }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const apiError = error instanceof ApiError ? error : new ApiError('INTERNAL_ERROR', 0);
        setSettled({ key: requestKey, result: { status: 'error', error: apiError } });
      },
    );
    return () => controller.abort();
  }, [path, locale, requestKey]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  // A result belonging to a previous language/path/attempt is stale: show loading instead.
  const state: ResourceState<T> =
    settled?.key === requestKey ? settled.result : { status: 'loading' };
  return { ...state, reload };
}
