import {
  PAYMENT_REJECT_REASON_LABEL_KEY,
  PAYMENT_REJECT_REASONS,
  rejectPaymentInputSchema,
  type AdminPaymentDto,
} from '@foodboll/contracts';
import { useState } from 'react';
import { useI18n } from '../../../i18n/I18nProvider';
import { Button } from '../../../ui/Button';
import { Sheet } from '../../../ui/Sheet';
import { useToast } from '../../../ui/Toast';
import { ActionError } from './ActionError';
import { useRejectPayment } from './api';
import type { PaymentHandlers } from './PaymentActions';
import { PaymentSummary } from './PaymentSummary';
import { isStaleState } from './resolution';

interface RejectSheetProps {
  readonly item: AdminPaymentDto | null;
  readonly onClose: () => void;
  readonly handlers: PaymentHandlers;
}

/**
 * Rejecting a receipt under review asks the player to pay again. The same call closes out a
 * cancelled registration whose money never arrived, and undoes a wrongly confirmed payment
 * (the player is asked to pay again). Each needs different wording.
 */
export function RejectSheet({ item, onClose, handlers }: RejectSheetProps) {
  const { t } = useI18n();
  const closing = item?.payment.status === 'REFUND_PENDING';
  const revoking = item?.payment.status === 'PAYMENT_CONFIRMED';
  return (
    <Sheet
      open={item !== null}
      title={
        closing
          ? t('adminPayments.closeTitle')
          : revoking
            ? t('adminPayments.revokeTitle')
            : t('adminPayments.rejectTitle')
      }
      onClose={onClose}
    >
      {item && (
        <RejectForm
          key={item.registrationId}
          item={item}
          closing={closing}
          revoking={revoking === true}
          onClose={onClose}
          handlers={handlers}
        />
      )}
    </Sheet>
  );
}

interface RejectFormProps {
  readonly item: AdminPaymentDto;
  readonly closing: boolean;
  readonly revoking: boolean;
  readonly onClose: () => void;
  readonly handlers: PaymentHandlers;
}

function RejectForm({ item, closing, revoking, onClose, handlers }: RejectFormProps) {
  const { t } = useI18n();
  const toast = useToast();
  const reject = useRejectPayment(item.registrationId);
  const [reason, setReason] = useState('');
  const input = rejectPaymentInputSchema.safeParse({ reason });
  const name = item.user.displayName;

  const submit = () => {
    if (!input.success) return;
    // The promise (not mutate's callbacks) because the sheet may be dismissed while this is in flight.
    void reject.mutateAsync(input.data.reason).then(
      () => {
        toast.show(t(revoking ? 'adminPayments.revoked' : 'adminPayments.rejected', { name }));
        handlers.resolved(item.registrationId);
      },
      (error: unknown) => {
        if (isStaleState(error)) handlers.stale();
      },
    );
  };

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <PaymentSummary item={item} />
      <p className="small muted">
        {closing
          ? t('adminPayments.closeHint')
          : revoking
            ? t('adminPayments.revokeHint')
            : t('adminPayments.rejectHint')}
      </p>
      <fieldset className="money-choices">
        <legend>{t('payment.rejectReasonLabel')}</legend>
        {PAYMENT_REJECT_REASONS.map((option) => (
          <label key={option} className="money-choice">
            <input
              type="radio"
              name="reject-reason"
              value={option}
              checked={reason === option}
              onChange={() => setReason(option)}
            />
            <span>{t(PAYMENT_REJECT_REASON_LABEL_KEY[option])}</span>
          </label>
        ))}
      </fieldset>
      <ActionError error={reject.error} />
      <Button
        type="submit"
        variant="danger"
        block
        loading={reject.isPending}
        disabled={!input.success}
      >
        {closing
          ? t('adminPayments.closeWithoutRefund')
          : revoking
            ? t('adminPayments.revokeSubmit')
            : t('adminPayments.rejectSubmit')}
      </Button>
      <Button block onClick={onClose}>
        {t('common.cancel')}
      </Button>
    </form>
  );
}
