import type { PaymentInstructionDto } from '@foodboll/contracts';
import { Breadcrumb } from '../components/Breadcrumb';
import { ErrorMessage } from '../components/ErrorMessage';
import { LocalizedText } from '../components/LocalizedText';
import { useApiResource } from '../hooks/useApiResource';
import { useI18n } from '../i18n/I18nProvider';

export function PaymentInfoPage() {
  const { t } = useI18n();
  const resource = useApiResource<PaymentInstructionDto>('/v1/payment-instructions/current');

  return (
    <section>
      <Breadcrumb
        trail={[{ to: '/me', label: t('myPage.title') }, { label: t('payment.instructionsTitle') }]}
      />
      <h1>{t('payment.account')}</h1>
      {resource.status === 'loading' && <p>{t('common.loading')}</p>}
      {resource.status === 'error' && (
        <ErrorMessage error={resource.error} onRetry={resource.reload} />
      )}
      {resource.status === 'success' && (
        <>
          <dl className="facts">
            <dt>{t('payment.bankName')}</dt>
            <dd>
              <LocalizedText value={resource.data.bankName} />
            </dd>
            <dt>{t('payment.accountNumber')}</dt>
            <dd>{resource.data.accountNumber}</dd>
            <dt>{t('payment.accountHolder')}</dt>
            <dd>{resource.data.accountHolder}</dd>
          </dl>
          <p className="prewrap">
            <LocalizedText value={resource.data.instructions} />
          </p>
        </>
      )}
    </section>
  );
}
