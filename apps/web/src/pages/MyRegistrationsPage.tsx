import {
  PAYMENT_REJECT_REASON_LABEL_KEY,
  PAYMENT_STATUS_LABEL_KEY,
  REGISTRATION_STATUS_LABEL_KEY,
  type Page,
  type RegistrationDto,
} from '@foodboll/contracts';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';
import { Breadcrumb } from '../components/Breadcrumb';
import { ErrorMessage } from '../components/ErrorMessage';
import { LocalizedText } from '../components/LocalizedText';
import { useApiResource } from '../hooks/useApiResource';
import { useI18n } from '../i18n/I18nProvider';

const MAX_RECEIPT_MB = 5;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

export function MyRegistrationsPage() {
  const { t } = useI18n();
  const resource = useApiResource<Page<RegistrationDto>>('/v1/me/registrations');
  return (
    <section>
      <Breadcrumb
        trail={[{ to: '/me', label: t('myPage.title') }, { label: t('registration.title') }]}
      />
      <h1>{t('registration.title')}</h1>
      {resource.status === 'loading' && <p>{t('common.loading')}</p>}
      {resource.status === 'error' && (
        <ErrorMessage error={resource.error} onRetry={resource.reload} />
      )}
      {resource.status === 'success' &&
        (resource.data.items.length === 0 ? (
          <p>{t('registration.empty')}</p>
        ) : (
          <ul className="cards">
            {resource.data.items.map((registration) => (
              <RegistrationCard
                key={registration.id}
                registration={registration}
                onChanged={resource.reload}
              />
            ))}
          </ul>
        ))}
    </section>
  );
}

function RegistrationCard({
  registration,
  onChanged,
}: {
  readonly registration: RegistrationDto;
  readonly onChanged: () => void;
}) {
  const { t, locale, formatDateTime, formatKrw } = useI18n();
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { payment, match } = registration;

  const canUpload =
    registration.status === 'APPLIED' &&
    payment !== null &&
    (payment.status === 'AWAITING_PAYMENT' || payment.status === 'PAYMENT_REJECTED');
  const canCancel = registration.status !== 'CANCELLED';

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError('INTERNAL_ERROR', 0));
    } finally {
      setBusy(false);
    }
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) return setError(new ApiError('INVALID_RECEIPT', 0));
    if (file.size > MAX_RECEIPT_MB * 1024 * 1024)
      return setError(new ApiError('PAYLOAD_TOO_LARGE', 0));
    void run(() =>
      apiRequest(`/v1/registrations/${registration.id}/receipt`, { method: 'PUT', file, locale }),
    );
  }

  return (
    <li className="card stack">
      <Link to={`/matches/${match.id}`}>
        <strong>
          <LocalizedText value={match.title} />
        </strong>
        <span>{formatDateTime(match.startsAt)}</span>
      </Link>
      <p>
        <span className="badge">{t(REGISTRATION_STATUS_LABEL_KEY[registration.status])}</span>
        {payment && <span className="badge">{t(PAYMENT_STATUS_LABEL_KEY[payment.status])}</span>}
      </p>
      {registration.status === 'CONFIRMED' && payment === null && (
        <p>{t('registration.freeConfirmed')}</p>
      )}
      {payment && registration.status !== 'CANCELLED' && (
        <dl className="facts">
          <dt>{t('payment.amount')}</dt>
          <dd>{formatKrw(payment.amountKrw)}</dd>
          {canUpload && (
            <>
              <dt>{t('registration.dueAt')}</dt>
              <dd>{formatDateTime(payment.dueAt)}</dd>
            </>
          )}
          {payment.rejectReason && (
            <>
              <dt>{t('payment.rejectReasonLabel')}</dt>
              <dd>{t(PAYMENT_REJECT_REASON_LABEL_KEY[payment.rejectReason])}</dd>
            </>
          )}
        </dl>
      )}
      {canUpload && (
        <div className="stack">
          <Link to="/me/payment">{t('payment.instructionsTitle')}</Link>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED_TYPES.join(',')}
            hidden
            onChange={(event) => onFile(event.target.files?.[0])}
          />
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            {t('payment.uploadReceipt')}
          </button>
          <small>{t('registration.receiptHint', { maxMb: MAX_RECEIPT_MB })}</small>
        </div>
      )}
      {canCancel && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(() =>
              apiRequest(`/v1/registrations/${registration.id}/cancel`, { method: 'POST', locale }),
            )
          }
        >
          {t('registration.cancel')}
        </button>
      )}
      {error && <ErrorMessage error={error} />}
    </li>
  );
}
