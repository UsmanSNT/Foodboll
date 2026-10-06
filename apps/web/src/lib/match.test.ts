import { describe, expect, it } from 'vitest';
import { formatTimeRange, groupByDay, hasEnded, hasStarted, seatTone } from './match';

describe('match helpers', () => {
  it('formats the time range in Korean time, even across midnight', () => {
    // 22:00–00:00 KST on 2026-12-11 is 13:00–15:00 UTC.
    expect(formatTimeRange('2026-12-11T13:00:00Z', '2026-12-11T15:00:00Z')).toBe('22:00–00:00');
  });

  it('groups by Korean calendar day, not UTC day', () => {
    const groups = groupByDay([
      { startsAt: '2026-12-10T16:00:00Z' }, // 01:00 KST on the 11th
      { startsAt: '2026-12-11T13:00:00Z' }, // 22:00 KST on the 11th
      { startsAt: '2026-12-11T15:00:00Z' }, // 00:00 KST on the 12th
    ]);
    expect(groups.map((g) => [g.key, g.items.length])).toEqual([
      ['2026-12-11', 2],
      ['2026-12-12', 1],
    ]);
  });

  it('tells started and ended matches apart', () => {
    const now = new Date('2026-12-11T14:00:00Z');
    const match = { startsAt: '2026-12-11T13:00:00Z', endsAt: '2026-12-11T15:00:00Z' };
    expect(hasStarted(match, now)).toBe(true);
    expect(hasEnded(match, now)).toBe(false);
  });

  it('flags nearly-full and full matches', () => {
    expect(seatTone({ spotsLeft: 8 })).toBeUndefined();
    expect(seatTone({ spotsLeft: 2 })).toBe('warn');
    expect(seatTone({ spotsLeft: 0 })).toBe('full');
  });
});
