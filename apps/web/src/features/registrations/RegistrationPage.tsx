import type { RegistrationDto } from '@foodboll/contracts';
import { PAYMENT_STATUS_LABEL_KEY } from '@foodboll/contracts';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { useApiMutation, useRegistration } from '../../api/queries';
import { useAuth } from '../../auth/AuthProvider';
import { useLoginGate } from '../../auth/useRequireLogin';
import { useI18n } from '../../i18n/I18nProvider';
import { hasStarted, isPast } from '../../lib/match';
import { Alert } from '../../ui/Alert';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { ChevronRight, ClipboardCheck } from '../../ui/icons';
import { PageHeader } from '../../ui/PageHeader';
import { Sheet } from '../../ui/Sheet';
import { ListSkeleton } from '../../ui/Skeleton';
import { useToast } from '../../ui/Toast';
import { MatchFacts } from '../match/MatchFacts';
import { PaymentPanel } from './PaymentPanel';
import { Stepper } from './Stepper';
import { paymentTone } from './status';

function currentStep(registration: RegistrationDto): 1 | 2 | 3 {
  if (registration.status === 'CONFIRMED') return 3;
  return 2;
}

function CancelRegistration({ registration }: { readonly registration: RegistrationDto }) {
  const { t } = useI18n();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const cancel = useApiMutation<void, RegistrationDto>(
    () => ({ path: `/v1/registrations/${registration.id}/cancel`, method: 'POST' }),
    [['registration', registration.id], ['registrations'], ['feed'], ['match'], ['match-players']],
  );
  const paid =
    registration.payment?.status === 'PAYMENT_CONFIRMED' ||
    registration.payment?.status === 'PAYMENT_REVIEW';

  return (
    <>
      <Button variant="ghost" block onClick={() => setOpen(true)}>
        {t('registration.cancel')}
      </Button>
      <Sheet open={open} title={t('registration.cancelConfirm')} onClose={() => setOpen(false)}>
        <div className="stack">
          {paid && <Alert tone="warning">{t('registration.cancelWarnPaid')}</Alert>}
          {cancel.isError && <ErrorState error={cancel.error} />}
          <Button
            variant="danger"
            block
            loading={cancel.isPending}
            onClick={() =>
              cancel.mutate(undefined, {
                onSuccess: () => {
                  setOpen(false);
                  toast.show(t('registration.cancelDone'));
                },
              })
            }
          >
            {t('registration.cancel')}
          </Button>
          <Button block onClick={() => setOpen(false)}>
            {t('registration.keep')}
          </Button>
        </div>
      </Sheet>
    </>
  );
}

export function RegistrationPage() {
  const { t } = useI18n();
  const { signedIn } = useAuth();
  const { openLogin } = useLoginGate();
  const { id = '' } = useParams();
  const query = useRegistration(id);

  const header = <PageHeader back title={t('registration.heading')} />;

  if (!signedIn) {
    return (
      <>
        {header}
        <div className="page">
          <EmptyState
            icon={<ClipboardCheck size={32} />}
            title={t('auth.title')}
            text={t('auth.subtitle')}
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
  if (query.isPending) {
    return (
      <>
        {header}
        <div className="page">
          <ListSkeleton rows={3} height={120} />
        </div>
      </>
    );
  }
  if (query.isError) {
    const missing =
      query.error instanceof ApiError && query.error.code === 'REGISTRATION_NOT_FOUND';
    return (
      <>
        {header}
        <div className="page">
          {missing ? (
            <ErrorState error={query.error} />
          ) : (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          )}
        </div>
      </>
    );
  }

  const registration = query.data;
  const cancelled = registration.status === 'CANCELLED';
  const payment = registration.payment;
  // Unpaid seats are released automatically once the payment window closes.
  const lapsed = cancelled && payment?.status === 'AWAITING_PAYMENT' && isPast(payment.dueAt);

  return (
    <>
      {header}
      <div className="page">
        {!cancelled && <Stepper current={currentStep(registration)} />}

        <Link to={`/matches/${registration.match.id}`} className="card card--pad stack reg-match">
          <div className="row row--between">
            <h2 lang={registration.match.title.locale}>{registration.match.title.text}</h2>
            <ChevronRight size={18} aria-hidden="true" />
          </div>
          <MatchFacts match={registration.match} />
          <div className="row row--wrap">
            {cancelled ? (
              <Badge>{t('match.cancelled')}</Badge>
            ) : payment ? (
              <Badge tone={paymentTone(payment.status)}>
                {t(PAYMENT_STATUS_LABEL_KEY[payment.status])}
              </Badge>
            ) : (
              <Badge tone="success">{t('match.confirmed')}</Badge>
            )}
          </div>
        </Link>

        {cancelled ? (
          <Alert tone="info">
            {lapsed ? t('payment.expiredNote') : t('registration.cancelDone')}
          </Alert>
        ) : (
          <PaymentPanel registration={registration} />
        )}

        {!cancelled && !hasStarted(registration.match) && (
          <CancelRegistration registration={registration} />
        )}
      </div>
    </>
  );
}
