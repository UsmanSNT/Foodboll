import type { PaymentStatus } from '@foodboll/contracts';
import type { Tone } from '../../ui/Badge';

/** Badge colour per payment state; the label itself comes from the catalog. */
export function paymentTone(status: PaymentStatus): Tone {
  switch (status) {
    case 'PAYMENT_CONFIRMED':
      return 'success';
    case 'AWAITING_PAYMENT':
      return 'warning';
    case 'PAYMENT_REVIEW':
      return 'info';
    case 'PAYMENT_REJECTED':
      return 'danger';
    case 'REFUND_PENDING':
      return 'warning';
    case 'REFUNDED':
      return 'neutral';
  }
}
