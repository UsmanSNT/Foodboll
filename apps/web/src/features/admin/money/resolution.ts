import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../../api/client';

/** How long a resolved card plays its exit animation: keep in step with `.money-item` in admin-money.css. */
export const EXIT_MS = 240;

export interface Resolution {
  /** True from the moment an item was resolved until the refreshed list no longer has it. */
  isLeaving(id: string): boolean;
  /** Plays the exit animation of a resolved item, then refreshes the queues. */
  leave(id: string): void;
  /** Refreshes the queues right away, e.g. when an action found the item already changed. */
  refresh(): void;
}

/**
 * Resolving an item removes it from its queue. The queues refresh only after the card has folded
 * away, so the list never jumps; leaving the screen early refreshes immediately instead.
 */
export function useResolution(queues: readonly (readonly unknown[])[]): Resolution {
  const queryClient = useQueryClient();
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Set<number>());
  // Read through a ref so `refresh` stays the same function even if the caller builds `queues` inline.
  const queuesRef = useRef(queues);
  useEffect(() => {
    queuesRef.current = queues;
  }, [queues]);

  const refresh = useCallback(() => {
    for (const key of queuesRef.current) void queryClient.invalidateQueries({ queryKey: [...key] });
  }, [queryClient]);

  const leave = useCallback(
    (id: string) => {
      setLeaving((current) => new Set(current).add(id));
      const timer = window.setTimeout(() => {
        timers.current.delete(timer);
        refresh();
      }, EXIT_MS);
      timers.current.add(timer);
    },
    [refresh],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      if (pending.size === 0) return;
      for (const timer of pending) window.clearTimeout(timer);
      pending.clear();
      refresh();
    };
  }, [refresh]);

  return useMemo(
    () => ({ isLeaving: (id) => leaving.has(id), leave, refresh }),
    [leaving, leave, refresh],
  );
}

/**
 * INVALID_STATE means someone else got there first, most often the automatic bank matcher. It is
 * not a failure to retry: the screen explains it and shows the item's real state instead.
 */
export function isStaleState(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'INVALID_STATE';
}
