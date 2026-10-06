import type { AdminPaymentDto } from '@foodboll/contracts';
import { useI18n } from '../../../i18n/I18nProvider';
import { ErrorState } from '../../../ui/ErrorState';
import { Sheet } from '../../../ui/Sheet';
import { Skeleton } from '../../../ui/Skeleton';
import { PaymentActions, type PaymentHandlers } from './PaymentActions';
import { PaymentSummary } from './PaymentSummary';
import { useReceipt } from './useReceipt';

function ReceiptViewer({
  registrationId,
  name,
}: {
  readonly registrationId: string;
  readonly name: string;
}) {
  const { t } = useI18n();
  const receipt = useReceipt(registrationId);

  if (receipt.status === 'loading') return <Skeleton height={240} />;
  if (receipt.status === 'error') return <ErrorState error={receipt.error} />;
  if (receipt.kind === 'pdf') {
    return (
      <div className="stack">
        <p className="small muted">{t('adminPayments.pdfNote')}</p>
        <a
          className="btn btn--primary btn--block"
          href={receipt.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('adminPayments.openPdf')}
        </a>
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="money-receipt">
        <img
          className="money-receipt__image"
          src={receipt.url}
          alt={t('adminPayments.receiptAlt', { name })}
        />
      </div>
      <a className="btn btn--block" href={receipt.url} target="_blank" rel="noopener noreferrer">
        {t('adminPayments.openInNewTab')}
      </a>
    </div>
  );
}

interface ReceiptSheetProps {
  readonly item: AdminPaymentDto | null;
  readonly onClose: () => void;
  readonly handlers: PaymentHandlers;
}

/** The uploaded receipt next to what was asked of the player, with the decision one tap away. */
export function ReceiptSheet({ item, onClose, handlers }: ReceiptSheetProps) {
  const { t } = useI18n();
  return (
    <Sheet open={item !== null} title={t('adminPayments.receiptTitle')} onClose={onClose}>
      {item && (
        <div className="stack">
          <PaymentSummary item={item} />
          <ReceiptViewer
            key={item.registrationId}
            registrationId={item.registrationId}
            name={item.user.displayName}
          />
          <p className="small muted">{t('adminPayments.receiptSensitive')}</p>
          <PaymentActions item={item} withReceipt={false} handlers={handlers} />
        </div>
      )}
    </Sheet>
  );
}
