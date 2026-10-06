import type { AdminPaymentDto } from '@foodboll/contracts';
import { useI18n } from '../../../i18n/I18nProvider';
import { Button } from '../../../ui/Button';
import { useToast } from '../../../ui/Toast';
import { ActionError } from './ActionError';
import { useConfirmPayment } from './api';
import { isStaleState } from './resolution';

export type SheetKind = 'receipt' | 'reject' | 'refund';

/** What the payment screen does when a card or one of its sheets finishes an action. */
export interface PaymentHandlers {
  readonly open: (kind: SheetKind, item: AdminPaymentDto) => void;
  /** The payment was settled: its sheet closes and its card leaves the queue. */
  readonly resolved: (registrationId: string) => void;
  /** The payment had already changed: say so and show its real state. */
  readonly stale: () => void;
}

interface PaymentActionsProps {
  readonly item: AdminPaymentDto;
  /** The receipt button is for the card; inside the receipt sheet the receipt is already open. */
  readonly withReceipt: boolean;
  readonly handlers: PaymentHandlers;
}

/** The buttons a payment offers in its current state: confirm or reject a review, settle a refund. */
export function PaymentActions({ item, withReceipt, handlers }: PaymentActionsProps) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirmPayment();
  const name = item.user.displayName;
  const reviewing = item.payment.status === 'PAYMENT_REVIEW';
  const refunding = item.payment.status === 'REFUND_PENDING';
  const receipt = withReceipt && item.payment.hasReceipt;
  if (!receipt && !reviewing && !refunding) return null;

  // Each button's name carries the player, so a list of cards stays distinguishable by ear.
  const label = (action: string) => t('adminPayments.actionLabel', { action, name });

  const onConfirm = () => {
    // The promise (not mutate's callbacks) because the receipt sheet may close while this is in flight.
    void confirm.mutateAsync(item.registrationId).then(
      () => {
        toast.show(t('adminPayments.confirmed', { name }));
        handlers.resolved(item.registrationId);
      },
      (error: unknown) => {
        if (isStaleState(error)) handlers.stale();
      },
    );
  };

  return (
    <div className="money-actions">
      <div className="money-actions__row">
        {receipt && (
          <Button aria-label={label(t('adminPayments.viewReceipt'))} onClick={() => handlers.open('receipt', item)}>
            {t('adminPayments.viewReceipt')}
          </Button>
        )}
        {reviewing && (
          <Button variant="danger" aria-label={label(t('adminPayments.reject'))} onClick={() => handlers.open('reject', item)}>
            {t('adminPayments.reject')}
          </Button>
        )}
        {refunding && (
          <Button aria-label={label(t('adminPayments.closeWithoutRefund'))} onClick={() => handlers.open('reject', item)}>
            {t('adminPayments.closeWithoutRefund')}
          </Button>
        )}
      </div>
      {reviewing && (
        <Button variant="primary" block loading={confirm.isPending} aria-label={label(t('adminPayments.confirm'))} onClick={onConfirm}>
          {t('adminPayments.confirm')}
        </Button>
      )}
      {refunding && (
        <Button variant="primary" block aria-label={label(t('adminPayments.refund'))} onClick={() => handlers.open('refund', item)}>
          {t('adminPayments.refund')}
        </Button>
      )}
      <ActionError error={confirm.error} />
    </div>
  );
}
