import type { AdminPaymentDto } from '@foodboll/contracts';
import { useI18n } from '../../../i18n/I18nProvider';
import { Alert } from '../../../ui/Alert';
import { Button } from '../../../ui/Button';
import { Sheet } from '../../../ui/Sheet';
import { useToast } from '../../../ui/Toast';
import { ActionError } from './ActionError';
import { useRefundPayment } from './api';
import type { PaymentHandlers } from './PaymentActions';
import { PaymentSummary } from './PaymentSummary';
import { isStaleState } from './resolution';

interface RefundSheetProps {
  readonly item: AdminPaymentDto | null;
  readonly onClose: () => void;
  readonly handlers: PaymentHandlers;
}

/** Recording a refund tells the player it is done, so it asks first and states the amount. */
export function RefundSheet({ item, onClose, handlers }: RefundSheetProps) {
  const { t } = useI18n();
  return (
    <Sheet open={item !== null} title={t('adminPayments.refundTitle')} onClose={onClose}>
      {item && (
        <RefundForm key={item.registrationId} item={item} onClose={onClose} handlers={handlers} />
      )}
    </Sheet>
  );
}

function RefundForm({
  item,
  onClose,
  handlers,
}: {
  readonly item: AdminPaymentDto;
  readonly onClose: () => void;
  readonly handlers: PaymentHandlers;
}) {
  const { t, formatKrw } = useI18n();
  const toast = useToast();
  const refund = useRefundPayment(item.registrationId);
  const name = item.user.displayName;

  const submit = () => {
    // The promise (not mutate's callbacks) because the sheet may be dismissed while this is in flight.
    void refund.mutateAsync().then(
      () => {
        toast.show(t('adminPayments.refunded', { name }));
        handlers.resolved(item.registrationId);
      },
      (error: unknown) => {
        if (isStaleState(error)) handlers.stale();
      },
    );
  };

  return (
    <div className="stack">
      <PaymentSummary item={item} withAmount={false} />
      <div className="money-refund">
        <span className="small muted">{t('adminPayments.refundAmount')}</span>
        <strong className="money-refund__amount num">{formatKrw(item.payment.amountKrw)}</strong>
      </div>
      <Alert tone="warning">{t('adminPayments.refundHint')}</Alert>
      <ActionError error={refund.error} />
      <Button variant="primary" block loading={refund.isPending} onClick={submit}>
        {t('adminPayments.refundSubmit')}
      </Button>
      <Button block onClick={onClose}>
        {t('common.cancel')}
      </Button>
    </div>
  );
}
