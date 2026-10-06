import type { BankDepositDto } from '@foodboll/contracts';
import { useMemo, useState } from 'react';
import { useI18n } from '../../../i18n/I18nProvider';
import { Button } from '../../../ui/Button';
import { EmptyState } from '../../../ui/EmptyState';
import { ErrorState } from '../../../ui/ErrorState';
import { Banknote } from '../../../ui/icons';
import { ListSkeleton } from '../../../ui/Skeleton';
import { useToast } from '../../../ui/Toast';
import { DEPOSIT_QUEUES, useAdminDeposits, type DepositTab } from './api';
import { AssignSheet } from './AssignSheet';
import { DepositCard, type DepositHandlers, type DepositSheetKind } from './DepositCard';
import { IgnoreSheet } from './IgnoreSheet';
import { DEPOSIT_EMPTY_KEY } from './labels';
import { uniqueBy } from './lists';
import { useResolution } from './resolution';

interface ActiveSheet {
  readonly kind: DepositSheetKind;
  readonly deposit: BankDepositDto;
}

/** One deposit queue with its cards and the sheets they open. Mount it per tab. */
export function DepositList({ tab }: { readonly tab: DepositTab }) {
  const { t } = useI18n();
  const toast = useToast();
  const query = useAdminDeposits(tab);
  const resolution = useResolution(DEPOSIT_QUEUES);
  const [active, setActive] = useState<ActiveSheet | null>(null);

  const { leave, refresh } = resolution;
  const handlers = useMemo<DepositHandlers>(
    () => ({
      open: (kind, deposit) => setActive({ kind, deposit }),
      resolved: (depositId) => {
        // Only the sheet of this deposit: the admin may have opened another one meanwhile.
        setActive((current) => (current?.deposit.id === depositId ? null : current));
        leave(depositId);
      },
      stale: () => {
        setActive(null);
        toast.show(t('errors.INVALID_STATE'));
        refresh();
      },
    }),
    [leave, refresh, toast, t],
  );
  const closer = (kind: DepositSheetKind) => () =>
    setActive((current) => (current?.kind === kind ? null : current));
  const depositOf = (kind: DepositSheetKind) => (active?.kind === kind ? active.deposit : null);

  const items = useMemo(
    () => uniqueBy(query.data?.pages.flatMap((page) => page.items) ?? [], (deposit) => deposit.id),
    [query.data],
  );
  const loadMore = () => void query.fetchNextPage();

  if (query.isPending) return <ListSkeleton rows={3} height={240} />;
  if (query.isError && !query.data)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (items.length === 0)
    return <EmptyState icon={<Banknote size={32} />} title={t(DEPOSIT_EMPTY_KEY[tab])} />;

  return (
    <>
      <ul className="money-list">
        {items.map((deposit) => (
          <DepositCard
            key={deposit.id}
            deposit={deposit}
            leaving={resolution.isLeaving(deposit.id)}
            handlers={handlers}
          />
        ))}
      </ul>
      {query.isError && (
        <ErrorState
          error={query.error}
          onRetry={query.isFetchNextPageError ? loadMore : () => void query.refetch()}
        />
      )}
      {query.hasNextPage && !query.isFetchNextPageError && (
        <Button block loading={query.isFetchingNextPage} onClick={loadMore}>
          {t('feed.loadMore')}
        </Button>
      )}
      <AssignSheet deposit={depositOf('assign')} onClose={closer('assign')} handlers={handlers} />
      <IgnoreSheet deposit={depositOf('ignore')} onClose={closer('ignore')} handlers={handlers} />
    </>
  );
}
