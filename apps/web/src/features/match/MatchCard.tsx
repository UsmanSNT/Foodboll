import type { MatchSummaryDto } from '@foodboll/contracts';
import { LOCALES } from '@foodboll/i18n';
import { useId } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { formatClock } from '../../lib/dates';
import { regionLabel, seatTone } from '../../lib/match';
import { Badge } from '../../ui/Badge';
import { MapPin } from '../../ui/icons';
import { ProgressBar } from '../../ui/ProgressBar';

/** Short label + tone for the signed-in viewer's own registration, shown on the card. */
export function ViewerBadge({ match }: { readonly match: MatchSummaryDto }) {
  const { t } = useI18n();
  if (!match.viewer) return null;
  if (match.viewer.status === 'CONFIRMED')
    return <Badge tone="success">{t('match.badgeJoined')}</Badge>;
  if (match.viewer.status === 'APPLIED') return <Badge tone="warning">{t('match.applied')}</Badge>;
  return null;
}

export function SpotsMeter({ match }: { readonly match: MatchSummaryDto }) {
  const { t } = useI18n();
  const full = match.spotsLeft <= 0;
  return (
    <div className="spots">
      <ProgressBar
        value={match.registeredCount}
        max={match.maxPlayers}
        label={t('feed.joinedCount', { registered: match.registeredCount, max: match.maxPlayers })}
        tone={seatTone(match)}
      />
      <span className={full ? 'spots__text spots__text--full' : 'spots__text'}>
        {full ? t('feed.full') : t('feed.spotsLeft', { count: match.spotsLeft })}
      </span>
    </div>
  );
}

/** One match in a list: start time, title, where, how full, price. The whole card is the link. */
export function MatchCard({ match }: { readonly match: MatchSummaryDto }) {
  const { t, formatKrw } = useI18n();
  const id = useId();
  const [timeId, titleId, badgeId, metaId, factsId] = [
    'time',
    'title',
    'badge',
    'meta',
    'facts',
  ].map((part) => `${id}-${part}`) as [string, string, string, string, string];
  return (
    // Name: when, what, status, where. Seats left and price are read as the description.
    <Link
      to={`/matches/${match.id}`}
      className="card match-card"
      aria-labelledby={`${timeId} ${titleId} ${badgeId} ${metaId}`}
      aria-describedby={factsId}
    >
      <div className="match-card__time num" id={timeId}>
        <strong>{formatClock(match.startsAt)}</strong>
        <span>{formatClock(match.endsAt)}</span>
      </div>
      <div className="match-card__body">
        <div className="row row--between">
          <h3 className="match-card__title">
            <span id={titleId} lang={match.title.locale}>
              {match.title.text}
            </span>
            {match.title.isFallback && (
              <span
                className="lang-tag"
                role="img"
                aria-label={t('content.fallbackNotice', {
                  language: LOCALES[match.title.locale].nativeName,
                })}
              >
                {match.title.locale}
              </span>
            )}
          </h3>
          <span id={badgeId}>
            <ViewerBadge match={match} />
          </span>
        </div>
        <p className="match-card__meta" id={metaId}>
          <MapPin size={14} aria-hidden="true" />
          <span>
            {match.venueName} · {regionLabel(match.region)}
          </span>
        </p>
        <div className="row row--between" id={factsId}>
          <SpotsMeter match={match} />
          <span className="match-card__price num">
            {match.feeKrw === 0 ? t('match.free') : formatKrw(match.feeKrw)}
          </span>
        </div>
      </div>
    </Link>
  );
}
