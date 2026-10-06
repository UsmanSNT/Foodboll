import { describe, expect, it } from 'vitest';
import { addDays, dayInfo, formatClock, koreanDateKey, minutesUntil, upcomingDays } from './dates';

describe('Korean calendar helpers', () => {
  it('uses Korean time, not UTC or the device zone', () => {
    // 15:30 UTC on 11 Dec is 00:30 on 12 Dec in Seoul.
    expect(koreanDateKey('2026-12-11T15:30:00Z')).toBe('2026-12-12');
    expect(koreanDateKey('2026-12-11T14:59:00Z')).toBe('2026-12-11');
    expect(formatClock('2026-12-11T13:00:00Z')).toBe('22:00');
    expect(formatClock('2026-12-11T15:00:00Z')).toBe('00:00');
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('knows the weekday of a date', () => {
    expect(dayInfo('2026-12-11')).toEqual({ key: '2026-12-11', weekday: 5, month: 12, day: 11 });
    expect(dayInfo('2026-03-01').weekday).toBe(0);
  });

  it('lists consecutive upcoming days starting today in Korea', () => {
    const days = upcomingDays(3, new Date('2026-12-31T16:00:00Z')); // already 1 Jan in Seoul
    expect(days.map((d) => d.key)).toEqual(['2027-01-01', '2027-01-02', '2027-01-03']);
  });

  it('counts minutes until a deadline', () => {
    expect(minutesUntil('2026-01-01T01:00:00Z', new Date('2026-01-01T00:00:00Z'))).toBe(60);
    expect(minutesUntil('2026-01-01T00:00:00Z', new Date('2026-01-01T00:10:00Z'))).toBe(-10);
  });
});
