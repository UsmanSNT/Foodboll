/**
 * Calendar helpers in Korean time. Korea has no daylight saving, so a fixed +09:00 offset is exact;
 * the device's own time zone is deliberately ignored (players live in Korea, matches are local).
 */
const KST_OFFSET_MS = 9 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

export interface DayKey {
  readonly key: string;
  /** 0 = Sunday. */
  readonly weekday: number;
  readonly month: number;
  readonly day: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of an instant in Korea. */
export function koreanDateKey(value: Date | string | number): string {
  const kst = new Date(new Date(value).getTime() + KST_OFFSET_MS);
  return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}`;
}

/** Calendar math on a Korean date key, independent of any time zone. */
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export function dayInfo(key: string): DayKey {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return { key, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay(), month: m, day: d };
}

/** The next `count` Korean dates starting today. */
export function upcomingDays(count: number, now: Date = new Date()): DayKey[] {
  const today = koreanDateKey(now);
  return Array.from({ length: count }, (_, i) => dayInfo(addDays(today, i)));
}

/** `HH:mm` (24-hour) in Korea, whatever the user's language. */
export function formatClock(value: Date | string | number): string {
  const kst = new Date(new Date(value).getTime() + KST_OFFSET_MS);
  return `${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`;
}

/** Whole minutes from `now` until `target` (negative once passed). */
export function minutesUntil(target: Date | string, now: Date = new Date()): number {
  return Math.floor((new Date(target).getTime() - now.getTime()) / 60_000);
}
