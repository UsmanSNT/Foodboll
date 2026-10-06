import type { BankDepositDto } from '@foodboll/contracts';
import { useI18n } from '../../../i18n/I18nProvider';
import { RawMessage } from './RawMessage';

/** The deposit a sheet is about: amount, time and the message, so the admin never acts on the wrong one. */
export function DepositSummary({ deposit }: { readonly deposit: BankDepositDto }) {
  const { t, formatKrw, formatDateTime } = useI18n();
  return (
    <div className="stack">
      <dl className="kv money-summary">
        <dt>{t('payment.amount')}</dt>
        <dd className="num">{deposit.amountKrw === null ? t('adminDeposits.amountUnknown') : formatKrw(deposit.amountKrw)}</dd>
        <dt>{t('adminDeposits.receivedAt')}</dt>
        <dd>{formatDateTime(deposit.receivedAt)}</dd>
      </dl>
      <RawMessage text={deposit.rawText} />
    </div>
  );
}
