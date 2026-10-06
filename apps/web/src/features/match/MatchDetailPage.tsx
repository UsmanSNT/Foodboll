import type { LocalizedValueDto, MatchDto, RegistrationDto } from '@foodboll/contracts';
import { LOCALES } from '@foodboll/i18n';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { useApiMutation, useMatch, useMatchPlayers } from '../../api/queries';
import { useAuth } from '../../auth/AuthProvider';
import { useLoginGate } from '../../auth/useRequireLogin';
import { useI18n } from '../../i18n/I18nProvider';
import { hasStarted, mapSearchUrl } from '../../lib/match';
import { Avatar } from '../../ui/Avatar';
import { Button, ButtonLink } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { Calendar, ChevronRight, MapPin } from '../../ui/icons';
import { PageHeader } from '../../ui/PageHeader';
import { ListSkeleton } from '../../ui/Skeleton';
import { MatchFacts } from './MatchFacts';
import { SpotsMeter } from './MatchCard';

function ContentSection({
  title,
  value,
}: {
  readonly title: string;
  readonly value: LocalizedValueDto | null;
}) {
  const { t } = useI18n();
  if (!value) return null;
  return (
    <section className="card card--pad stack">
      <h2>{title}</h2>
      <p className="prewrap" lang={value.locale}>
        {value.text}
      </p>
      {value.isFallback && (
        <p className="small muted">
          {t('content.fallbackNotice', { language: LOCALES[value.locale].nativeName })}
        </p>
      )}
    </section>
  );
}

function Attendees({ matchId }: { readonly matchId: string }) {
  const { t } = useI18n();
  const players = useMatchPlayers(matchId);
  if (players.isPending) return null;
  const items = players.data?.items ?? [];
  return (
    <section className="card card--pad stack">
      <h2>{t('match.whoIsGoing')}</h2>
      {items.length === 0 ? (
        <p className="muted">{t('match.firstToJoin')}</p>
      ) : (
        <ul className="list" style={{ margin: '0 -16px' }}>
          {items.map((player) => (
            <li key={player.id}>
              <Link to={`/players/${player.id}`} className="list__item">
                <Avatar name={player.displayName} id={player.id} size="sm" />
                <span className="grow">{player.displayName}</span>
                <span className="small muted">
                  {t('stats.levelValue', { level: player.level.level })}
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function JoinBar({ match }: { readonly match: MatchDto }) {
  const { t, formatKrw } = useI18n();
  const { signedIn } = useAuth();
  const { openLogin } = useLoginGate();
  const navigate = useNavigate();
  const join = useApiMutation<void, RegistrationDto>(
    () => ({ path: `/v1/matches/${match.id}/registrations`, method: 'POST' }),
    [['feed'], ['match', match.id], ['registrations'], ['match-players', match.id]],
  );

  const registered = match.viewer && match.viewer.status !== 'CANCELLED';
  const fee = match.feeKrw === 0 ? t('match.free') : formatKrw(match.feeKrw);

  let action: React.ReactNode;
  if (registered) {
    action = (
      <ButtonLink
        variant="primary"
        size="lg"
        block
        to={`/registrations/${match.viewer?.registrationId}`}
      >
        {t('match.viewRegistration')}
      </ButtonLink>
    );
  } else if (hasStarted(match)) {
    action = (
      <Button size="lg" block disabled>
        {t('match.started')}
      </Button>
    );
  } else if (match.spotsLeft <= 0) {
    action = (
      <Button size="lg" block disabled>
        {t('feed.full')}
      </Button>
    );
  } else if (!signedIn) {
    action = (
      <Button variant="primary" size="lg" block onClick={openLogin}>
        {t('match.loginToJoin')}
      </Button>
    );
  } else {
    action = (
      <Button
        variant="primary"
        size="lg"
        block
        loading={join.isPending}
        onClick={() =>
          join.mutate(undefined, { onSuccess: (reg) => void navigate(`/registrations/${reg.id}`) })
        }
      >
        {t('match.apply')} · {fee}
      </Button>
    );
  }

  return (
    <div className="cta-bar">
      <div className="cta-bar__inner stack">
        {join.isError && <ErrorState error={join.error} />}
        {action}
      </div>
    </div>
  );
}

export function MatchDetailPage() {
  const { t, formatKrw } = useI18n();
  const { signedIn } = useAuth();
  const { id = '' } = useParams();
  const match = useMatch(id);

  if (match.isPending) {
    return (
      <>
        <PageHeader back plain title={t('nav.matches')} />
        <div className="page">
          <ListSkeleton rows={3} height={140} />
        </div>
      </>
    );
  }
  if (match.isError) {
    const notFound = match.error instanceof ApiError && match.error.code === 'MATCH_NOT_FOUND';
    return (
      <>
        <PageHeader back plain title={t('nav.matches')} />
        <div className="page">
          {notFound ? (
            <EmptyState
              icon={<Calendar size={32} />}
              title={t('match.notFound')}
              action={<ButtonLink to="/">{t('nav.matches')}</ButtonLink>}
            />
          ) : (
            <ErrorState error={match.error} onRetry={() => void match.refetch()} />
          )}
        </div>
      </>
    );
  }

  const m = match.data;
  const mapQuery = m.venueAddress ?? m.venueName;
  return (
    <>
      <PageHeader back plain title={t('nav.matches')} />
      <div className="page page--with-cta">
        <section className="card card--pad stack match-hero">
          <h1 lang={m.title.locale}>{m.title.text}</h1>
          {m.title.isFallback && (
            <p className="small muted">
              {t('content.fallbackNotice', { language: LOCALES[m.title.locale].nativeName })}
            </p>
          )}
          <MatchFacts match={m} />
          {m.venueAddress && <p className="small muted">{m.venueAddress}</p>}
          <a
            className="btn btn--secondary btn--sm"
            href={mapSearchUrl(mapQuery)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MapPin size={16} aria-hidden="true" />
            {t('match.openMap')}
          </a>
        </section>

        <section className="tiles" aria-label={t('match.format')}>
          <div className="tile">
            <span className="tile__label">{t('match.format')}</span>
            <strong className="tile__value num">
              {t('match.formatValue', { size: m.playersPerSide })}
            </strong>
          </div>
          <div className="tile">
            <span className="tile__label">{t('match.fee')}</span>
            <strong className="tile__value num">
              {m.feeKrw === 0 ? t('match.free') : formatKrw(m.feeKrw)}
            </strong>
          </div>
          <div className="tile tile--wide">
            <span className="tile__label">
              {t('match.maxPlayers')}: {m.maxPlayers}
            </span>
            <SpotsMeter match={m} />
          </div>
        </section>

        <ContentSection title={t('match.description')} value={m.description} />
        <ContentSection title={t('match.locationInstructions')} value={m.locationInstructions} />
        <ContentSection title={t('match.equipmentRequirements')} value={m.equipmentRequirements} />
        <ContentSection title={t('match.rules')} value={m.rules} />
        <ContentSection title={t('match.cancellationPolicy')} value={m.cancellationPolicy} />

        {signedIn && <Attendees matchId={m.id} />}
      </div>
      <JoinBar match={m} />
    </>
  );
}
