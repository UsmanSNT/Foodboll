import type { MatchSummaryDto, RegionDto } from '@foodboll/contracts';
import { formatClock, koreanDateKey } from './dates';

/** `22:00–00:00`, always Korean time. */
export function formatTimeRange(startsAt: string, endsAt: string): string {
  return `${formatClock(startsAt)}–${formatClock(endsAt)}`;
}

/** `Gyeonggi Suwon` for a district, `Seoul` for a province. */
export function regionLabel(region: RegionDto): string {
  return region.parent ? `${region.parent.name.text} ${region.name.text}` : region.name.text;
}

/** Naver Map search works for any Korean address or venue name, and has an English interface. */
export function mapSearchUrl(query: string): string {
  return `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
}

export function isPast(iso: string, now: Date = new Date()): boolean {
  return new Date(iso).getTime() <= now.getTime();
}

export function hasStarted(match: Pick<MatchSummaryDto, 'startsAt'>, now: Date = new Date()): boolean {
  return new Date(match.startsAt).getTime() <= now.getTime();
}

export function hasEnded(match: Pick<MatchSummaryDto, 'endsAt'>, now: Date = new Date()): boolean {
  return new Date(match.endsAt).getTime() <= now.getTime();
}

export type SeatTone = 'warn' | 'full' | undefined;

export function seatTone(match: Pick<MatchSummaryDto, 'spotsLeft'>): SeatTone {
  if (match.spotsLeft <= 0) return 'full';
  return match.spotsLeft <= 2 ? 'warn' : undefined;
}

/** Groups matches (already in start order) by Korean calendar day. */
export function groupByDay<T extends { readonly startsAt: string }>(
  items: readonly T[],
): { readonly key: string; readonly items: readonly T[] }[] {
  const groups: { key: string; items: T[] }[] = [];
  for (const item of items) {
    const key = koreanDateKey(item.startsAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, items: [item] });
  }
  return groups;
}
