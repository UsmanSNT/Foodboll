import { useId } from 'react';
import { useI18n } from '../../../../i18n/I18nProvider';
import type { PlayerPaymentView } from './payment-form';

/** The bank card a player sees while paying (same structure and wording as the registration screen). */
export function PaymentCard({ view }: { readonly view: PlayerPaymentView }) {
  const { t } = useI18n();
  const headingId = useId();
  return (
    <section className="card card--pad stack" aria-labelledby={headingId}>
      <h3 id={headingId}>{t('payment.account')}</h3>
      <dl className="kv">
        <dt>{t('payment.bankName')}</dt>
        <dd lang={view.bankName.locale}>{view.bankName.text}</dd>
        <dt>{t('payment.accountNumber')}</dt>
        <dd className="num">{view.accountNumber}</dd>
        <dt>{t('payment.accountHolder')}</dt>
        <dd>{view.accountHolder}</dd>
      </dl>
      <p className="prewrap small muted" lang={view.instructions.locale}>
        {view.instructions.text}
      </p>
    </section>
  );
}
