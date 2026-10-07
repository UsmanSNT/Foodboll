import type { MatchSummaryDto } from '@foodboll/contracts';
import { useI18n } from '../../../i18n/I18nProvider';
import { formatTimeRange, hasEnded, hasStarted, regionLabel } from '../../../lib/match';
import { Badge } from '../../../ui/Badge';
import { ButtonLink } from '../../../ui/Button';
import { ClipboardCheck, MapPin } from '../../../ui/icons';
import { SpotsMeter } from '../../match/MatchCard';
import { CancelMatchButton } from '../CancelMatchButton';

/** One announced match with the three things an organizer does with it: roster, edit, view. */
export function OrganizedMatchCard({
  match,
  now,
}: {
  readonly match: MatchSummaryDto;
  readonly now: Date;
}) {
  const { t, formatDate } = useI18n();
  const started = hasStarted(match, now);
  const cancelled = match.cancelledAt !== null;
  const live = started && !cancelled && !hasEnded(match, now);
  const label = (action: string) =>
    t('organizer.home.actionLabel', { action, title: match.title.text });

  return (
    <article className="card organizer-match">
      <div className="organizer-match__main">
        <div className="match-card__time match-card__time--date num">
          <strong>{formatDate(match.startsAt)}</strong>
          <span>{formatTimeRange(match.startsAt, match.endsAt)}</span>
        </div>
        <div className="match-card__body">
          <div className="row row--between">
            <h3 className="match-card__title" lang={match.title.locale}>
              {match.title.text}
            </h3>
            {live && <Badge tone="info">{t('organizer.home.live')}</Badge>}
            {cancelled && <Badge tone="danger">{t('match.cancelled')}</Badge>}
          </div>
          <p className="match-card__meta">
            <MapPin size={14} aria-hidden="true" />
            <span>
              {match.venueName} · {regionLabel(match.region)}
            </span>
          </p>
          {!cancelled && (
            <div className="row row--between">
              <SpotsMeter match={match} />
              <span className="match-card__price num">
                {t('feed.joinedCount', {
                  registered: match.registeredCount,
                  max: match.maxPlayers,
                })}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="organizer-match__actions">
        {!cancelled && (
          <ButtonLink
            variant={started ? 'primary' : 'secondary'}
            to={`/organizer/matches/${match.id}/roster`}
            aria-label={label(t('organizer.home.roster'))}
          >
            <ClipboardCheck size={18} aria-hidden="true" />
            {t('organizer.home.roster')}
          </ButtonLink>
        )}
        {!started && !cancelled && (
          <ButtonLink
            to={`/organizer/matches/${match.id}/edit`}
            aria-label={label(t('organizer.home.edit'))}
          >
            {t('organizer.home.edit')}
          </ButtonLink>
        )}
        {!started && !cancelled && <CancelMatchButton matchId={match.id} title={match.title} />}
        <ButtonLink
          variant="ghost"
          to={`/matches/${match.id}`}
          aria-label={label(t('organizer.home.view'))}
        >
          {t('organizer.home.view')}
        </ButtonLink>
      </div>
    </article>
  );
}
