import type { MatchSummaryDto, Page } from '@foodboll/contracts';
import { hasEnded } from '../../../lib/match';

export interface OrganizedMatches {
  /** Not over yet (a match in progress still belongs here), soonest first. */
  readonly upcoming: readonly MatchSummaryDto[];
  /** Finished, newest first. */
  readonly past: readonly MatchSummaryDto[];
}

/**
 * Splits the loaded pages into the two tabs. Offset paging can repeat a match when one is
 * announced between two page loads, so duplicates are dropped by id.
 */
export function splitOrganizedMatches(pages: readonly Page<MatchSummaryDto>[], now: Date): OrganizedMatches {
  const byId = new Map<string, MatchSummaryDto>();
  for (const page of pages) for (const match of page.items) byId.set(match.id, match);
  const all = [...byId.values()];
  const upcoming = all.filter((match) => !hasEnded(match, now)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = all.filter((match) => hasEnded(match, now)).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  return { upcoming, past };
}
