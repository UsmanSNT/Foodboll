import type { BankDepositDto, Page } from '@foodboll/contracts';

export interface DepositSlice {
  readonly items: readonly BankDepositDto[];
  /** Offsets to continue from, one per status; null when every queue is exhausted. */
  readonly next: number[] | null;
}

/**
 * Newest first, like the API orders each queue (`receivedAt`, then `id`, both descending), so a
 * merge of several queues reads as one list.
 */
const newestFirst = (a: BankDepositDto, b: BankDepositDto) =>
  b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id);

/**
 * Merges one page from each status queue into a single newest-first page of `size` items.
 *
 * Items beyond `size` are dropped and read again by the next page, because the returned offsets
 * only count what was actually shown. That keeps the merged list in true time order however the
 * queues interleave, which paging each queue separately could not.
 */
export function mergeDepositPages(
  pages: readonly Page<BankDepositDto>[],
  offsets: readonly number[],
  size: number,
): DepositSlice {
  const tagged = pages
    .flatMap((page, source) => page.items.map((item) => ({ item, source })))
    .sort((a, b) => newestFirst(a.item, b.item));
  const shown = tagged.slice(0, size);
  const next = offsets.map((offset, source) => offset + shown.filter((entry) => entry.source === source).length);
  // A full page may have more behind it; a short one is the end of its queue.
  const more = tagged.length > shown.length || pages.some((page) => page.items.length >= size);
  return { items: shown.map((entry) => entry.item), next: more ? next : null };
}
