import { ErrorState } from '../../../ui/ErrorState';
import { isStaleState } from './resolution';

/** The inline failure of an action. A stale item is handled by refreshing, so it shows nothing here. */
export function ActionError({ error }: { readonly error: unknown }) {
  if (error === null || error === undefined || isStaleState(error)) return null;
  return <ErrorState error={error} />;
}
