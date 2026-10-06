import { describe, expect, it } from 'vitest';
import {
  activityLevel,
  computeXp,
  earnedAchievements,
  LEVEL_XP_THRESHOLDS,
  levelFromXp,
  MAX_LEVEL,
} from '../progression';

describe('levelFromXp', () => {
  it.each([
    [0, 1],
    [19, 1],
    [20, 2],
    [49, 2],
    [50, 3],
    [1399, 9],
    [1400, 10],
    [999_999, 10],
  ])('%i xp is level %i', (xp, level) => expect(levelFromXp(xp).level).toBe(level));

  it('reports progress inside the level', () => {
    expect(levelFromXp(35)).toEqual({ level: 2, xp: 35, xpIntoLevel: 15, xpForNextLevel: 30 });
    expect(levelFromXp(0)).toEqual({ level: 1, xp: 0, xpIntoLevel: 0, xpForNextLevel: 20 });
  });

  it('has no next level at the top', () => {
    expect(levelFromXp(5000)).toMatchObject({ level: MAX_LEVEL, xpForNextLevel: null });
  });

  it('is monotonic and clamps nonsense input', () => {
    let previous = 0;
    for (let xp = 0; xp <= 1600; xp += 5) {
      const { level } = levelFromXp(xp);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
    expect(levelFromXp(-50).level).toBe(1);
    expect(levelFromXp(12.9).xp).toBe(12);
    expect(LEVEL_XP_THRESHOLDS[0]).toBe(0);
  });
});

describe('xp, achievements and activity', () => {
  it('rewards playing and organizing', () => {
    expect(computeXp({ matchesPlayed: 3, matchesOrganized: 2 })).toBe(60);
  });

  it('awards achievements from the numbers', () => {
    const base = { matchesPlayed: 0, noShows: 0, matchesOrganized: 0, provincesPlayed: 0 };
    expect(earnedAchievements(base)).toEqual([]);
    expect(earnedAchievements({ ...base, matchesPlayed: 1 })).toEqual(['FIRST_MATCH']);
    expect(
      earnedAchievements({ ...base, matchesPlayed: 10, provincesPlayed: 3, matchesOrganized: 1 }),
    ).toEqual([
      'FIRST_MATCH',
      'MATCHES_5',
      'MATCHES_10',
      'PERFECT_ATTENDANCE',
      'ORGANIZER',
      'EXPLORER',
    ]);
    // A no-show forfeits the attendance award.
    expect(earnedAchievements({ ...base, matchesPlayed: 10, noShows: 1 })).not.toContain(
      'PERFECT_ATTENDANCE',
    );
    // Perfect attendance needs a real sample, not one lucky match.
    expect(earnedAchievements({ ...base, matchesPlayed: 4 })).not.toContain('PERFECT_ATTENDANCE');
  });

  it('classifies recent activity', () => {
    expect(activityLevel({ matchesPlayed: 0, last90Days: 0 })).toBe('NEW');
    expect(activityLevel({ matchesPlayed: 8, last90Days: 0 })).toBe('INACTIVE');
    expect(activityLevel({ matchesPlayed: 8, last90Days: 2 })).toBe('OCCASIONAL');
    expect(activityLevel({ matchesPlayed: 8, last90Days: 8 })).toBe('REGULAR');
    expect(activityLevel({ matchesPlayed: 30, last90Days: 12 })).toBe('VERY_ACTIVE');
  });
});
