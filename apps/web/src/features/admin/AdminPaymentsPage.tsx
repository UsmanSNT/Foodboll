import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { Alert } from '../../ui/Alert';
import { Chip } from '../../ui/Chip';
import { PageHeader } from '../../ui/PageHeader';
import { PAYMENT_HINT_KEY, PAYMENT_TAB_LABEL_KEY, PAYMENT_TABS } from './money/labels';
import { PaymentList } from './money/PaymentList';
import { useChoiceParam } from './money/useChoiceParam';

/** Payments a person has to look at. Most are confirmed automatically from bank deposit messages. */
export function AdminPaymentsPage() {
  const { t } = useI18n();
  const [status, setStatus] = useChoiceParam('status', PAYMENT_TABS, 'PAYMENT_REVIEW');

  return (
    <>
      <PageHeader back title={t('adminPayments.title')} />
      <div className="page">
        <Alert tone="info">
          {t('adminPayments.autoNote')}{' '}
          <Link className="money-link" to="/admin/deposits">
            {t('adminPayments.toDeposits')}
          </Link>
        </Alert>
        <div className="chips" role="group" aria-label={t('adminPayments.filterLabel')}>
          {PAYMENT_TABS.map((tab) => (
            <Chip key={tab} className="money-chip" selected={tab === status} onClick={() => setStatus(tab)}>
              {t(PAYMENT_TAB_LABEL_KEY[tab])}
            </Chip>
          ))}
        </div>
        <p className="small muted">{t(PAYMENT_HINT_KEY[status])}</p>
        <PaymentList key={status} status={status} />
      </div>
    </>
  );
}
