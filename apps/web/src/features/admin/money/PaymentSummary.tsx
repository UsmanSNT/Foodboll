import type { AdminPaymentDto } from '@foodboll/contracts';
import { useI18n } from '../../../i18n/I18nProvider';

/** Who and what a sheet is about, so the admin never acts on the wrong payment. */
export function PaymentSummary({
  item,
  withAmount = true,
}: {
  readonly item: AdminPaymentDto;
  readonly withAmount?: boolean;
}) {
  const { t, formatKrw } = useI18n();
  return (
    <dl className="kv money-summary">
      <dt>{t('glossary.player')}</dt>
      <dd>{item.user.displayName}</dd>
      <dt>{t('glossary.match')}</dt>
      <dd lang={item.match.title.locale}>{item.match.title.text}</dd>
      {withAmount && (
        <>
          <dt>{t('payment.amount')}</dt>
          <dd className="num">{formatKrw(item.payment.amountKrw)}</dd>
        </>
      )}
      {item.payment.referenceCode && (
        <>
          <dt>{t('adminPayments.reference')}</dt>
          <dd className="money-code">{item.payment.referenceCode}</dd>
        </>
      )}
    </dl>
  );
}
