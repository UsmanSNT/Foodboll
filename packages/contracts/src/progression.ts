import type { MessageKey } from '@foodboll/i18n';

/**
 * Player progression. Pure and shared, so the API and every client compute levels the same way.
 * Only matches the organizer confirmed the player actually attended count.
 */
export const XP_PER_MATCH_PLAYED = 10;
export const XP_PER_MATCH_ORGANIZED = 15;

/** Total XP needed to reach level n+1 (index n). The last level has no next threshold. */
export const LEVEL_XP_THRESHOLDS = [0, 20, 50, 100, 180, 300, 480, 720, 1000, 1400] as const;
export const MAX_LEVEL = LEVEL_XP_THRESHOLDS.length;

export interface LevelProgress {
  readonly level: number;
  readonly xp: number;
  /** XP earned since reaching this level. */
  readonly xpIntoLevel: number;
  /** XP the whole current level spans, or null at the maximum level. */
  readonly xpForNextLevel: number | null;
}

export function computeXp(stats: { matchesPlayed: number; matchesOrganized: number }): number {
  return (
    stats.matchesPlayed * XP_PER_MATCH_PLAYED + stats.matchesOrganized * XP_PER_MATCH_ORGANIZED
  );
}

export function levelFromXp(xp: number): LevelProgress {
  const safe = Math.max(0, Math.floor(xp));
  let index = 0;
  while (
    index + 1 < LEVEL_XP_THRESHOLDS.length &&
    safe >= (LEVEL_XP_THRESHOLDS[index + 1] ?? Infinity)
  ) {
    index++;
  }
  const floor = LEVEL_XP_THRESHOLDS[index] ?? 0;
  const next = LEVEL_XP_THRESHOLDS[index + 1];
  return {
    level: index + 1,
    xp: safe,
    xpIntoLevel: safe - floor,
    xpForNextLevel: next === undefined ? null : next - floor,
  };
}

export const ACHIEVEMENT_IDS = [
  'FIRST_MATCH',
  'MATCHES_5',
  'MATCHES_10',
  'MATCHES_25',
  'PERFECT_ATTENDANCE',
  'ORGANIZER',
  'EXPLORER',
] as const;
export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

export const ACHIEVEMENT_LABEL_KEY = {
  FIRST_MATCH: 'achievement.FIRST_MATCH',
  MATCHES_5: 'achievement.MATCHES_5',
  MATCHES_10: 'achievement.MATCHES_10',
  MATCHES_25: 'achievement.MATCHES_25',
  PERFECT_ATTENDANCE: 'achievement.PERFECT_ATTENDANCE',
  ORGANIZER: 'achievement.ORGANIZER',
  EXPLORER: 'achievement.EXPLORER',
} as const satisfies Record<AchievementId, MessageKey>;

export interface AchievementInput {
  readonly matchesPlayed: number;
  /** Confirmed players the organizer marked as not having shown up. */
  readonly noShows: number;
  readonly matchesOrganized: number;
  /** Distinct provinces the player has played in. */
  readonly provincesPlayed: number;
}

export function earnedAchievements(s: AchievementInput): AchievementId[] {
  const earned: [AchievementId, boolean][] = [
    ['FIRST_MATCH', s.matchesPlayed >= 1],
    ['MATCHES_5', s.matchesPlayed >= 5],
    ['MATCHES_10', s.matchesPlayed >= 10],
    ['MATCHES_25', s.matchesPlayed >= 25],
    ['PERFECT_ATTENDANCE', s.matchesPlayed >= 5 && s.noShows === 0],
    ['ORGANIZER', s.matchesOrganized >= 1],
    ['EXPLORER', s.provincesPlayed >= 3],
  ];
  return earned.filter(([, ok]) => ok).map(([id]) => id);
}

/** How active a player has been lately, from attendance in the last 90 days. */
export const ACTIVITY_LEVELS = ['NEW', 'INACTIVE', 'OCCASIONAL', 'REGULAR', 'VERY_ACTIVE'] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

export const ACTIVITY_LABEL_KEY = {
  NEW: 'profile.activity.NEW',
  INACTIVE: 'profile.activity.INACTIVE',
  OCCASIONAL: 'profile.activity.OCCASIONAL',
  REGULAR: 'profile.activity.REGULAR',
  VERY_ACTIVE: 'profile.activity.VERY_ACTIVE',
} as const satisfies Record<ActivityLevel, MessageKey>;

export function activityLevel(s: { matchesPlayed: number; last90Days: number }): ActivityLevel {
  if (s.matchesPlayed === 0) return 'NEW';
  if (s.last90Days === 0) return 'INACTIVE';
  if (s.last90Days <= 3) return 'OCCASIONAL';
  if (s.last90Days <= 11) return 'REGULAR';
  return 'VERY_ACTIVE';
}
