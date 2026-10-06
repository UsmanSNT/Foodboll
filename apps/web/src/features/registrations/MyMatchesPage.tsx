import type { RegistrationDto } from '@foodboll/contracts';
import { PAYMENT_STATUS_LABEL_KEY } from '@foodboll/contracts';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMyRegistrations } from '../../api/queries';
import { useAuth } from '../../auth/AuthProvider';
import { useLoginGate } from '../../auth/useRequireLogin';
import { useI18n } from '../../i18n/I18nProvider';
import { formatTimeRange, hasEnded, regionLabel } from '../../lib/match';
import { Badge } from '../../ui/Badge';
import { Button, ButtonLink } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { Calendar, ChevronRight, MapPin } from '../../ui/icons';
import { PageHeader } from '../../ui/PageHeader';
import { Segmented } from '../../ui/Segmented';
import { ListSkeleton } from '../../ui/Skeleton';
import { paymentTone } from './status';

function RegistrationCard({ registration }: { readonly registration: RegistrationDto }) {
  const { t, formatDate } = useI18n();
  const { match, payment } = registration;
  const cancelled = registration.status === 'CANCELLED';
  return (
    <Link to={`/registrations/${registration.id}`} className="card match-card">
      <div className="match-card__time match-card__time--date num" aria-hidden="true">
        <strong>{formatDate(match.startsAt)}</strong>
        <span>{formatTimeRange(match.startsAt, match.endsAt)}</span>
      </div>
      <div className="match-card__body">
        <div className="row row--between">
          <h3 className="match-card__title" lang={match.title.locale}>
            {match.title.text}
          </h3>
          <ChevronRight size={16} aria-hidden="true" />
        </div>
        <p className="match-card__meta">
          <MapPin size={14} aria-hidden="true" />
          <span>
            {match.venueName} · {regionLabel(match.region)}
          </span>
        </p>
        <div className="row row--wrap">
          {cancelled ? (
            <Badge>{t('match.cancelled')}</Badge>
          ) : payment ? (
            <Badge tone={paymentTone(payment.status)}>{t(PAYMENT_STATUS_LABEL_KEY[payment.status])}</Badge>
          ) : (
            <Badge tone="success">{t('match.confirmed')}</Badge>
          )}
          {payment?.status === 'AWAITING_PAYMENT' && !cancelled && <Badge tone="accent">{t('match.badgePay')}</Badge>}
        </div>
      </div>
    </Link>
  );
}

export function MyMatchesPage() {
  const { t } = useI18n();
  const { signedIn } = useAuth();
  const { openLogin } = useLoginGate();
  const registrations = useMyRegistrations();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');

  const { upcoming, past } = useMemo(() => {
    const now = new Date();
    const items = registrations.data?.items ?? [];
    const isPast = (r: RegistrationDto) => r.status === 'CANCELLED' || hasEnded(r.match, now);
    const byStart = (a: RegistrationDto, b: RegistrationDto) => a.match.startsAt.localeCompare(b.match.startsAt);
    return {
      upcoming: items.filter((r) => !isPast(r)).sort(byStart),
      past: items.filter(isPast).sort((a, b) => byStart(b, a)),
    };
  }, [registrations.data]);

  if (!signedIn) {
    return (
      <>
        <PageHeader title={t('nav.myMatches')} />
        <div className="page">
          <EmptyState
            icon={<Calendar size={32} />}
            title={t('myMatches.loginRequired')}
            action={
              <Button variant="primary" onClick={openLogin}>
                {t('auth.login')}
              </Button>
            }
          />
        </div>
      </>
    );
  }

  const list = tab === 'upcoming' ? upcoming : past;
  return (
    <>
      <PageHeader title={t('nav.myMatches')} />
      <div className="page">
        <Segmented
          label={t('nav.myMatches')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'upcoming', label: `${t('myMatches.upcoming')} (${upcoming.length})` },
            { value: 'past', label: `${t('myMatches.past')} (${past.length})` },
          ]}
        />
        {registrations.isPending && <ListSkeleton rows={2} />}
        {registrations.isError && <ErrorState error={registrations.error} onRetry={() => void registrations.refetch()} />}
        {registrations.isSuccess && list.length === 0 && (
          <EmptyState
            icon={<Calendar size={32} />}
            title={tab === 'upcoming' ? t('myMatches.emptyUpcoming') : t('myMatches.emptyPast')}
            action={
              tab === 'upcoming' ? (
                <ButtonLink variant="primary" to="/">
                  {t('myMatches.find')}
                </ButtonLink>
              ) : undefined
            }
          />
        )}
        {list.map((registration) => (
          <RegistrationCard key={registration.id} registration={registration} />
        ))}
      </div>
    </>
  );
}
