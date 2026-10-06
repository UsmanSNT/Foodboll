import type { AdminPaymentInstructionDto } from '@foodboll/contracts';
import { LOCALES } from '@foodboll/i18n';
import { useI18n } from '../../../../i18n/I18nProvider';
import { Alert } from '../../../../ui/Alert';
import { nativeNames } from '../locale-record';
import { PaymentCard } from './PaymentCard';
import { playerView } from './payment-form';

/** Read-only: what players see right now, so the admin knows what a save replaces. */
export function CurrentPayment({
  current,
}: {
  readonly current: AdminPaymentInstructionDto | null;
}) {
  const { t, locale } = useI18n();
  const view = current && playerView(current, locale);

  if (!current || !view) {
    return (
      <Alert tone="warning">
        <strong>{t('adminSettings.payment.current.noneTitle')}</strong>{' '}
        {t('adminSettings.payment.current.noneText')}
      </Alert>
    );
  }
  return (
    <section className="stack" aria-labelledby="as-current-title">
      <h2 id="as-current-title" className="section-title">
        {t('adminSettings.payment.current.title')}
      </h2>
      <PaymentCard view={view} />
      <p className="small muted">
        {t('adminSettings.payment.current.shownAs', { language: LOCALES[locale].nativeName })}
      </p>
      {current.missingLanguages.length > 0 && (
        <Alert tone="warning">
          {t('adminSettings.payment.current.missing', {
            languages: nativeNames(current.missingLanguages),
          })}
        </Alert>
      )}
    </section>
  );
}
