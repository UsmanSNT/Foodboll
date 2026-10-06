import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { Alert } from '../../ui/Alert';
import { PageHeader } from '../../ui/PageHeader';
import { Segmented } from '../../ui/Segmented';
import { DEPOSIT_HINT_KEY, DEPOSIT_TAB_LABEL_KEY, DEPOSIT_TABS } from './money/labels';
import { DepositList } from './money/DepositList';
import { useChoiceParam } from './money/useChoiceParam';

/** Bank deposits the automatic matcher could not place, and the history of those it could. */
export function AdminDepositsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useChoiceParam('tab', DEPOSIT_TABS, 'needs');

  return (
    <>
      <PageHeader back title={t('adminDeposits.title')} />
      <div className="page">
        <Alert tone="info">
          {t('adminDeposits.autoNote')}{' '}
          <Link className="money-link" to="/admin/payments">
            {t('adminDeposits.toPayments')}
          </Link>
        </Alert>
        <div className="money-segmented">
          <Segmented
            label={t('adminDeposits.tabsLabel')}
            value={tab}
            onChange={setTab}
            options={DEPOSIT_TABS.map((value) => ({ value, label: t(DEPOSIT_TAB_LABEL_KEY[value]) }))}
          />
        </div>
        <p className="small muted">{t(DEPOSIT_HINT_KEY[tab])}</p>
        <DepositList key={tab} tab={tab} />
      </div>
    </>
  );
}
