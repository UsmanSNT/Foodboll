import type { BankDepositDto } from '@foodboll/contracts';
import { useI18n } from '../../../i18n/I18nProvider';
import { Alert } from '../../../ui/Alert';
import { Button } from '../../../ui/Button';
import { Sheet } from '../../../ui/Sheet';
import { useToast } from '../../../ui/Toast';
import { ActionError } from './ActionError';
import { useIgnoreDeposit } from './api';
import type { DepositHandlers } from './DepositCard';
import { DepositSummary } from './DepositSummary';
import { isStaleState } from './resolution';

interface IgnoreSheetProps {
  readonly deposit: BankDepositDto | null;
  readonly onClose: () => void;
  readonly handlers: DepositHandlers;
}

/** Ignoring is final for the matcher, so it explains that first. */
export function IgnoreSheet({ deposit, onClose, handlers }: IgnoreSheetProps) {
  const { t } = useI18n();
  return (
    <Sheet open={deposit !== null} title={t('adminDeposits.ignoreTitle')} onClose={onClose}>
      {deposit && <IgnoreForm key={deposit.id} deposit={deposit} onClose={onClose} handlers={handlers} />}
    </Sheet>
  );
}

function IgnoreForm({ deposit, onClose, handlers }: { readonly deposit: BankDepositDto; readonly onClose: () => void; readonly handlers: DepositHandlers }) {
  const { t } = useI18n();
  const toast = useToast();
  const ignore = useIgnoreDeposit(deposit.id);

  const submit = () => {
    // The promise (not mutate's callbacks) because the sheet may be dismissed while this is in flight.
    void ignore.mutateAsync().then(
      () => {
        toast.show(t('adminDeposits.ignored'));
        handlers.resolved(deposit.id);
      },
      (error: unknown) => {
        if (isStaleState(error)) handlers.stale();
      },
    );
  };

  return (
    <div className="stack">
      <DepositSummary deposit={deposit} />
      <Alert tone="warning">{t('adminDeposits.ignoreText')}</Alert>
      <ActionError error={ignore.error} />
      <Button variant="danger" block loading={ignore.isPending} onClick={submit}>
        {t('adminDeposits.ignoreSubmit')}
      </Button>
      <Button block onClick={onClose}>
        {t('common.cancel')}
      </Button>
    </div>
  );
}
