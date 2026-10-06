import { ACHIEVEMENT_LABEL_KEY, ACTIVITY_LABEL_KEY, type PlayerProfileDto } from '@foodboll/contracts';
import type { ReactNode } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { regionLabel } from '../../lib/match';
import { Avatar } from '../../ui/Avatar';
import { Badge } from '../../ui/Badge';
import { MapPin, Medal } from '../../ui/icons';
import { ProgressBar } from '../../ui/ProgressBar';
import { MatchCard } from '../match/MatchCard';

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="tile">
      <span className="tile__label">{label}</span>
      <strong className="tile__value num">{value}</strong>
    </div>
  );
}

/** A player's public page: level, activity, games played, achievements and recent matches. */
export function ProfileView({ profile, extra }: { readonly profile: PlayerProfileDto; readonly extra?: ReactNode }) {
  const { t, formatDateLong } = useI18n();
  const { level, stats } = profile;
  const percent = (value: number) => `${Math.round(value * 100)}%`;

  return (
    <div className="page">
      <section className="card card--pad profile-hero">
        <Avatar name={profile.displayName} id={profile.id} size="xl" />
        <div className="stack" style={{ gap: 4 }}>
          <h1>{profile.displayName}</h1>
          {profile.homeRegion && (
            <p className="muted row" style={{ justifyContent: 'center' }}>
              <MapPin size={14} aria-hidden="true" />
              {regionLabel(profile.homeRegion)}
            </p>
          )}
        </div>
        <div className="row row--wrap" style={{ justifyContent: 'center' }}>
          <Badge tone="primary">{t('stats.levelValue', { level: level.level })}</Badge>
          <Badge tone="accent">{t(ACTIVITY_LABEL_KEY[profile.activity])}</Badge>
        </div>
        <div className="stack" style={{ width: '100%', gap: 6 }}>
          <ProgressBar
            value={level.xpIntoLevel}
            max={level.xpForNextLevel ?? Math.max(level.xpIntoLevel, 1)}
            label={t('stats.experience')}
          />
          <p className="small muted">
            {level.xpForNextLevel === null
              ? t('profile.maxLevel')
              : t('profile.xpToNext', { xp: level.xpForNextLevel - level.xpIntoLevel })}
          </p>
        </div>
      </section>

      <section className="tiles tiles--4" aria-label={t('stats.title')}>
        <Stat label={t('profile.matchesPlayed')} value={String(stats.matchesPlayed)} />
        <Stat label={t('profile.last90Days')} value={String(stats.last90Days)} />
        <Stat label={t('profile.matchesOrganized')} value={String(stats.matchesOrganized)} />
        <Stat label={t('profile.attendanceRate')} value={stats.attendanceRate === null ? '–' : percent(stats.attendanceRate)} />
      </section>

      {extra}

      {profile.achievements.length > 0 && (
        <section className="stack">
          <h2 className="section-title">{t('stats.achievements')}</h2>
          <ul className="achievements">
            {profile.achievements.map((id) => (
              <li key={id} className="achievement">
                <Medal size={18} aria-hidden="true" />
                {t(ACHIEVEMENT_LABEL_KEY[id])}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="stack">
        <h2 className="section-title">{t('profile.recentMatches')}</h2>
        {profile.recentMatches.length === 0 ? (
          <p className="muted">{t('profile.noMatchesYet')}</p>
        ) : (
          profile.recentMatches.map((match) => <MatchCard key={match.id} match={match} />)
        )}
      </section>

      <p className="small muted" style={{ textAlign: 'center' }}>
        {t('profile.memberSince')}: {formatDateLong(profile.memberSince)}
      </p>
    </div>
  );
}
