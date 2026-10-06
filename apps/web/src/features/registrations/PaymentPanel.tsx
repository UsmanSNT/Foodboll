import { PAYMENT_REJECT_REASON_LABEL_KEY, type RegistrationDto } from '@foodboll/contracts';
import { usePaymentInstruction } from '../../api/queries';
import { useI18n } from '../../i18n/I18nProvider';
import { Alert } from '../../ui/Alert';
import { ErrorState } from '../../ui/ErrorState';
import { Skeleton } from '../../ui/Skeleton';
import { CopyButton } from './CopyButton';
import { DepositorNameForm } from './DepositorNameForm';
import { ReceiptUpload } from './ReceiptUpload';

function PayInstructions({ registration }: { readonly registration: RegistrationDto }) {
  const { t, formatKrw, formatDateTime } = useI18n();
  const payment = registration.payment!;
  const instruction = usePaymentInstruction(true);
  const accountDigits = instruction.data ? instruction.data.accountNumber.replace(/\D/g, '') : '';

  return (
    <>
      <section className="card card--pad pay-amount" aria-label={t('payment.amount')}>
        <span className="muted small">{t('payment.amount')}</span>
        <strong className="pay-amount__value num">{formatKrw(payment.amountKrw)}</strong>
        <span className="small">{t('payment.dueBy', { time: formatDateTime(payment.dueAt) })}</span>
      </section>

      <section className="card card--pad stack">
        <h2>{t('payment.account')}</h2>
        {instruction.isPending && <Skeleton height={96} />}
        {instruction.isError && <ErrorState error={instruction.error} onRetry={() => void instruction.refetch()} />}
        {instruction.data && (
          <>
            <dl className="kv">
              <dt>{t('payment.bankName')}</dt>
              <dd lang={instruction.data.bankName.locale}>{instruction.data.bankName.text}</dd>
              <dt>{t('payment.accountNumber')}</dt>
              <dd className="num">{instruction.data.accountNumber}</dd>
              <dt>{t('payment.accountHolder')}</dt>
              <dd>{instruction.data.accountHolder}</dd>
            </dl>
            <div className="row row--wrap">
              <CopyButton value={accountDigits || instruction.data.accountNumber} label={t('payment.accountNumber')} />
            </div>
            <p className="prewrap small muted" lang={instruction.data.instructions.locale}>
              {instruction.data.instructions.text}
            </p>
          </>
        )}
      </section>

      {payment.referenceCode && (
        <section className="card card--pad stack reference">
          <div>
            <h2>{t('payment.referenceTitle')}</h2>
            <p className="muted small">{t('payment.referenceHint')}</p>
          </div>
          <div className="reference__row">
            <strong className="reference__code num" aria-label={payment.referenceCode.split('').join(' ')}>
              {payment.referenceCode}
            </strong>
            <CopyButton value={payment.referenceCode} label={t('payment.referenceTitle')} />
          </div>
        </section>
      )}

      <section className="card card--pad">
        <DepositorNameForm />
      </section>

      <Alert tone="info">{t('payment.autoNote')}</Alert>
    </>
  );
}

/** Everything the player needs for the current payment state, and nothing else. */
export function PaymentPanel({ registration }: { readonly registration: RegistrationDto }) {
  const { t } = useI18n();
  const payment = registration.payment;
  if (!payment) return <Alert tone="success">{t('registration.freeConfirmed')}</Alert>;

  switch (payment.status) {
    case 'AWAITING_PAYMENT':
      return (
        <>
          <PayInstructions registration={registration} />
          <ReceiptUpload registrationId={registration.id} />
        </>
      );
    case 'PAYMENT_REJECTED':
      return (
        <>
          <Alert>
            {t('payment.rejectedNote')}
            {payment.rejectReason && (
              <>
                {' '}
                {t('payment.rejectReasonLabel')}: {t(PAYMENT_REJECT_REASON_LABEL_KEY[payment.rejectReason])}
              </>
            )}
          </Alert>
          <PayInstructions registration={registration} />
          <ReceiptUpload registrationId={registration.id} />
        </>
      );
    case 'PAYMENT_REVIEW':
      return <Alert tone="info">{t('payment.inReview')}</Alert>;
    case 'PAYMENT_CONFIRMED':
      return <Alert tone="success">{t('payment.confirmedNote')}</Alert>;
    case 'REFUND_PENDING':
      return <Alert tone="warning">{t('payment.refundPendingNote')}</Alert>;
    case 'REFUNDED':
      return <Alert tone="info">{t('payment.refundedNote')}</Alert>;
  }
}
