import type { AdminPaymentDto, PaymentStatus } from '@foodboll/contracts';
import { useCallback, useMemo, useState } from 'react';
import { useI18n } from '../../../i18n/I18nProvider';
import { Button } from '../../../ui/Button';
import { EmptyState } from '../../../ui/EmptyState';
import { ErrorState } from '../../../ui/ErrorState';
import { Wallet } from '../../../ui/icons';
import { ListSkeleton } from '../../../ui/Skeleton';
import { useToast } from '../../../ui/Toast';
import { PAYMENT_QUEUES, useAdminPayments } from './api';
import { PAYMENT_EMPTY_KEY } from './labels';
import { PaymentCard } from './PaymentCard';
import type { PaymentHandlers, SheetKind } from './PaymentActions';
import { ReceiptSheet } from './ReceiptSheet';
import { RefundSheet } from './RefundSheet';
import { RejectSheet } from './RejectSheet';
import { useResolution } from './resolution';
import { uniqueBy } from './lists';

interface ActiveSheet {
  readonly kind: SheetKind;
  readonly item: AdminPaymentDto;
}

/** One payment queue with its cards and the sheets they open. Mount it per status. */
export function PaymentList({ status }: { readonly status: PaymentStatus }) {
  const { t } = useI18n();
  const toast = useToast();
  const query = useAdminPayments(status);
  const resolution = useResolution(PAYMENT_QUEUES);
  const [active, setActive] = useState<ActiveSheet | null>(null);

  const { leave, refresh } = resolution;
  const handlers = useMemo<PaymentHandlers>(
    () => ({
      open: (kind, item) => setActive({ kind, item }),
      resolved: (registrationId) => {
        // Only the sheet of this payment: the admin may have opened another one meanwhile.
        setActive((current) => (current?.item.registrationId === registrationId ? null : current));
        leave(registrationId);
      },
      stale: () => {
        setActive(null);
        toast.show(t('errors.INVALID_STATE'));
        refresh();
      },
    }),
    [leave, refresh, toast, t],
  );
  // A sheet that closes itself must not close the one that replaced it (receipt -> reject).
  const closer = (kind: SheetKind) => () => setActive((current) => (current?.kind === kind ? null : current));
  const itemOf = (kind: SheetKind) => (active?.kind === kind ? active.item : null);

  const items = useMemo(
    () => uniqueBy(query.data?.pages.flatMap((page) => page.items) ?? [], (item) => item.registrationId),
    [query.data],
  );
  const loadMore = useCallback(() => void query.fetchNextPage(), [query]);

  if (query.isPending) return <ListSkeleton rows={3} height={220} />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (items.length === 0) return <EmptyState icon={<Wallet size={32} />} title={t(PAYMENT_EMPTY_KEY[status])} />;

  return (
    <>
      <ul className="money-list">
        {items.map((item) => (
          <PaymentCard key={item.registrationId} item={item} leaving={resolution.isLeaving(item.registrationId)} handlers={handlers} />
        ))}
      </ul>
      {query.isError && <ErrorState error={query.error} onRetry={query.isFetchNextPageError ? loadMore : () => void query.refetch()} />}
      {query.hasNextPage && !query.isFetchNextPageError && (
        <Button block loading={query.isFetchingNextPage} onClick={loadMore}>
          {t('feed.loadMore')}
        </Button>
      )}
      <ReceiptSheet item={itemOf('receipt')} onClose={closer('receipt')} handlers={handlers} />
      <RejectSheet item={itemOf('reject')} onClose={closer('reject')} handlers={handlers} />
      <RefundSheet item={itemOf('refund')} onClose={closer('refund')} handlers={handlers} />
    </>
  );
}
