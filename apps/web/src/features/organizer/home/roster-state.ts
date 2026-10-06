import type { MatchSummaryDto, RosterEntryDto } from '@foodboll/contracts';
import type { AttendanceMark } from '../api';

/** `true` came, `false` did not, `null` not decided yet. */
export type Mark = boolean | null;

/** Unsaved choices by registration id. Only differences from what the server holds are kept. */
export type Drafts = Readonly<Record<string, boolean>>;

const DAY_MS = 24 * 3600 * 1000;
/** Mirrors the API: marks can be made from kick-off until this long after the match ends. */
export const ATTENDANCE_WINDOW_DAYS = 14;

export type MarkingState = 'before' | 'open' | 'closed';

export function markingState(
  match: Pick<MatchSummaryDto, 'startsAt' | 'endsAt'>,
  now: Date,
): MarkingState {
  if (new Date(match.startsAt).getTime() > now.getTime()) return 'before';
  const closesAt = new Date(match.endsAt).getTime() + ATTENDANCE_WINDOW_DAYS * DAY_MS;
  return now.getTime() > closesAt ? 'closed' : 'open';
}

export function markOf(entry: RosterEntryDto, drafts: Drafts): Mark {
  return drafts[entry.registrationId] ?? entry.attended;
}

/**
 * Records a choice. Choosing what the server already holds, or "not marked", drops the draft.
 * ("Not marked" is only reachable while the server has no mark: a saved mark cannot be cleared.)
 */
export function withMark(drafts: Drafts, entry: RosterEntryDto, value: Mark): Drafts {
  const { [entry.registrationId]: _previous, ...rest } = drafts;
  return value === null || value === entry.attended
    ? rest
    : { ...rest, [entry.registrationId]: value };
}

/** Everyone not decided yet becomes present; marks that are already decided stay as they are. */
export function withRestPresent(drafts: Drafts, roster: readonly RosterEntryDto[]): Drafts {
  const next: Record<string, boolean> = { ...drafts };
  for (const entry of roster) if (markOf(entry, drafts) === null) next[entry.registrationId] = true;
  return next;
}

/** What to send: decided marks that differ from the server, for players still on the roster. */
export function pendingMarks(roster: readonly RosterEntryDto[], drafts: Drafts): AttendanceMark[] {
  return roster.flatMap((entry) => {
    const draft = drafts[entry.registrationId];
    return draft === undefined || draft === entry.attended
      ? []
      : [{ registrationId: entry.registrationId, attended: draft }];
  });
}

export function summarize(roster: readonly RosterEntryDto[], drafts: Drafts) {
  let present = 0;
  let absent = 0;
  for (const entry of roster) {
    const mark = markOf(entry, drafts);
    if (mark === true) present++;
    else if (mark === false) absent++;
  }
  return { present, absent, unmarked: roster.length - present - absent };
}
