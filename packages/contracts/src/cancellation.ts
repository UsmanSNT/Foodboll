/** A player may cancel their own registration only while MORE than this many hours remain. */
export const PLAYER_CANCELLATION_CUTOFF_HOURS = 5;

const CUTOFF_MS = PLAYER_CANCELLATION_CUTOFF_HOURS * 3600 * 1000;

/**
 * True while strictly more than the cutoff remains before kick-off, compared at the exact
 * instant: exactly 5 h left is already closed, 5 h and 1 ms is still open.
 */
export function isPlayerCancellationOpen(startsAt: Date | string, now: Date): boolean {
  return new Date(startsAt).getTime() - now.getTime() > CUTOFF_MS;
}
