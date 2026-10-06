import { addDays } from '../../../lib/dates';

/**
 * Match times are written and read in Korean time whatever the organizer's device says, so
 * every instant here is built by hand from the entered wall-clock values with a fixed offset
 * (Korea has no daylight saving) and never through `new Date(year, month, ...)`.
 */
export const KST_OFFSET = '+09:00';
export const MAX_MATCH_HOURS = 12;

const DAY_MINUTES = 24 * 60;
const MAX_MATCH_MINUTES = MAX_MATCH_HOURS * 60;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** True for a real calendar date written `YYYY-MM-DD` (rejects `2030-02-30`). */
export function isDateKey(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Minutes after midnight for a 24-hour `HH:mm`, or null when it is not one. */
function minutesOfDay(value: string): number | null {
  const match = TIME_PATTERN.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export const isTimeOfDay = (value: string): boolean => minutesOfDay(value) !== null;

export interface MatchWindow {
  /** ISO 8601 with the +09:00 offset, as the API expects. */
  readonly startsAt: string;
  readonly endsAt: string;
  /** Korean calendar date on which the match ends. */
  readonly endDate: string;
  /** An end time at or before the start time means after midnight (22:00-00:00 is normal). */
  readonly endsNextDay: boolean;
  readonly minutes: number;
}

/** Combines the three form inputs into the match window, or null while any of them is missing or invalid. */
export function resolveWindow(
  date: string,
  startTime: string,
  endTime: string,
): MatchWindow | null {
  const start = minutesOfDay(startTime);
  const end = minutesOfDay(endTime);
  if (!isDateKey(date) || start === null || end === null) return null;
  const endsNextDay = end <= start;
  const endDate = endsNextDay ? addDays(date, 1) : date;
  return {
    startsAt: `${date}T${startTime}:00${KST_OFFSET}`,
    endsAt: `${endDate}T${endTime}:00${KST_OFFSET}`,
    endDate,
    endsNextDay,
    minutes: (endsNextDay ? end + DAY_MINUTES : end) - start,
  };
}

export type WindowProblem = 'startInPast' | 'tooLong';

/** Rules the API enforces on the window: it must start in the future and last at most 12 hours. */
export function windowProblems(window: MatchWindow, now: Date): WindowProblem[] {
  const problems: WindowProblem[] = [];
  if (Date.parse(window.startsAt) <= now.getTime()) problems.push('startInPast');
  if (window.minutes > MAX_MATCH_MINUTES) problems.push('tooLong');
  return problems;
}

export function splitDuration(minutes: number): {
  readonly hours: number;
  readonly minutes: number;
} {
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}
