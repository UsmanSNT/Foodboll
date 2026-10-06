import { useI18n } from '../../i18n/I18nProvider';
import { ErrorState } from '../../ui/ErrorState';
import { ListSkeleton } from '../../ui/Skeleton';
import { useAdminPaymentInstruction } from './settings/api';
import { PaymentEditor } from './settings/payment/PaymentEditor';
import { SettingsFrame } from './settings/SettingsFrame';

/** The bank account players send money to, and the instructions they read next to it. */
export function AdminPaymentInfoPage() {
  const { t } = useI18n();
  const query = useAdminPaymentInstruction();

  if (query.isError) {
    return (
      <SettingsFrame title={t('adminSettings.payment.title')}>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </SettingsFrame>
    );
  }
  if (query.isPending) {
    return (
      <SettingsFrame title={t('adminSettings.payment.title')}>
        <ListSkeleton rows={3} height={140} />
      </SettingsFrame>
    );
  }
  // A saved version has a new id, so saving replaces the form with one that starts from it.
  return <PaymentEditor key={query.data?.id ?? 'new'} current={query.data} />;
}
