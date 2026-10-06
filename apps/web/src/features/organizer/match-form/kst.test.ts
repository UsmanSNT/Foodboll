import { matchInputSchema } from '@foodboll/contracts';
import { describe, expect, it } from 'vitest';
import { isDateKey, resolveWindow, splitDuration, windowProblems } from './kst';

const isoField = matchInputSchema.shape.startsAt;

describe('resolveWindow', () => {
  it('builds ISO strings with the +09:00 offset that name the right instants', () => {
    const window = resolveWindow('2030-05-04', '22:00', '23:30');
    expect(window).toMatchObject({
      startsAt: '2030-05-04T22:00:00+09:00',
      endsAt: '2030-05-04T23:30:00+09:00',
      endsNextDay: false,
      minutes: 90,
    });
    // 22:00 in Seoul is 13:00 UTC, whatever zone the test machine runs in.
    expect(new Date(window?.startsAt ?? '').toISOString()).toBe('2030-05-04T13:00:00.000Z');
    expect(isoField.safeParse(window?.startsAt).success).toBe(true);
    expect(isoField.safeParse(window?.endsAt).success).toBe(true);
  });

  it('treats an end time past midnight as the next day', () => {
    const window = resolveWindow('2030-05-04', '22:00', '00:00');
    expect(window).toMatchObject({
      endsAt: '2030-05-05T00:00:00+09:00',
      endDate: '2030-05-05',
      endsNextDay: true,
      minutes: 120,
    });
  });

  it('rolls the end date over month and year boundaries', () => {
    expect(resolveWindow('2030-12-31', '23:00', '01:00')?.endsAt).toBe('2031-01-01T01:00:00+09:00');
    expect(resolveWindow('2030-02-28', '23:30', '00:30')?.endDate).toBe('2030-03-01');
    expect(resolveWindow('2032-02-28', '23:30', '00:30')?.endDate).toBe('2032-02-29');
  });

  it('keeps early-morning Korean times on the Korean date even though UTC is the day before', () => {
    const window = resolveWindow('2030-05-04', '00:30', '02:00');
    expect(window?.startsAt).toBe('2030-05-04T00:30:00+09:00');
    expect(new Date(window?.startsAt ?? '').toISOString()).toBe('2030-05-03T15:30:00.000Z');
  });

  it('reads an end equal to the start as a full day', () => {
    expect(resolveWindow('2030-05-04', '10:00', '10:00')).toMatchObject({ endsNextDay: true, minutes: 1440 });
  });

  it('returns null until every part is a valid date or time', () => {
    expect(resolveWindow('', '10:00', '12:00')).toBeNull();
    expect(resolveWindow('2030-05-04', '', '12:00')).toBeNull();
    expect(resolveWindow('2030-05-04', '10:00', '')).toBeNull();
    expect(resolveWindow('2030-02-30', '10:00', '12:00')).toBeNull();
    expect(resolveWindow('2030-05-04', '24:00', '12:00')).toBeNull();
    expect(resolveWindow('2030-05-04', '10:60', '12:00')).toBeNull();
    expect(resolveWindow('2030-5-4', '10:00', '12:00')).toBeNull();
  });
});

describe('isDateKey', () => {
  it('accepts real calendar dates only', () => {
    expect(isDateKey('2032-02-29')).toBe(true);
    expect(isDateKey('2031-02-29')).toBe(false);
    expect(isDateKey('2030-13-01')).toBe(false);
    expect(isDateKey('not a date')).toBe(false);
  });
});

describe('windowProblems', () => {
  const now = new Date('2030-05-04T00:00:00Z'); // 09:00 on 4 May in Seoul

  it('accepts a match that starts later and lasts up to 12 hours', () => {
    expect(windowProblems(resolveWindow('2030-05-04', '10:00', '22:00') ?? fail(), now)).toEqual([]);
  });

  it('refuses a match longer than 12 hours', () => {
    expect(windowProblems(resolveWindow('2030-05-04', '10:00', '22:01') ?? fail(), now)).toEqual(['tooLong']);
    expect(windowProblems(resolveWindow('2030-05-04', '10:00', '10:00') ?? fail(), now)).toEqual(['tooLong']);
  });

  it('refuses a start that is not in the future, judged in Korean time', () => {
    expect(windowProblems(resolveWindow('2030-05-04', '08:59', '10:00') ?? fail(), now)).toEqual(['startInPast']);
    expect(windowProblems(resolveWindow('2030-05-04', '09:00', '10:00') ?? fail(), now)).toEqual(['startInPast']);
    expect(windowProblems(resolveWindow('2030-05-04', '09:01', '10:00') ?? fail(), now)).toEqual([]);
    expect(windowProblems(resolveWindow('2030-05-03', '23:00', '23:30') ?? fail(), now)).toEqual(['startInPast']);
  });

  it('reports both problems together', () => {
    expect(windowProblems(resolveWindow('2030-05-03', '08:00', '23:00') ?? fail(), now)).toEqual(['startInPast', 'tooLong']);
  });
});

describe('splitDuration', () => {
  it('splits minutes into hours and minutes', () => {
    expect(splitDuration(150)).toEqual({ hours: 2, minutes: 30 });
    expect(splitDuration(120)).toEqual({ hours: 2, minutes: 0 });
    expect(splitDuration(45)).toEqual({ hours: 0, minutes: 45 });
  });
});

function fail(): never {
  throw new Error('window did not resolve');
}
