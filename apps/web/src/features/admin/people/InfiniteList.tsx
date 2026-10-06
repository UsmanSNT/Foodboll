import type { Page } from '@foodboll/contracts';
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import { useMemo, type ReactNode } from 'react';
import { useI18n } from '../../../i18n/I18nProvider';
import { Button } from '../../../ui/Button';
import { ErrorState } from '../../../ui/ErrorState';

interface Props<T> {
  readonly query: UseInfiniteQueryResult<InfiniteData<Page<T>>>;
  /** Shown while the first page loads. */
  readonly skeleton: ReactNode;
  /** Shown when the list is empty. */
  readonly empty: ReactNode;
  readonly children: (items: readonly T[]) => ReactNode;
}

/** Loading, error, empty and "show more" for a paged list, so each screen only renders its rows. */
export function InfiniteList<T>({ query, skeleton, empty, children }: Props<T>) {
  const { t } = useI18n();
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);

  if (query.isPending) return skeleton;
  if (query.isError && !query.data)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (items.length === 0) return empty;

  return (
    <>
      {children(items)}
      {query.isFetchNextPageError && (
        <ErrorState error={query.error} onRetry={() => void query.fetchNextPage()} />
      )}
      {query.hasNextPage && !query.isFetchNextPageError && (
        <Button block loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          {t('adminPeople.loadMore')}
        </Button>
      )}
    </>
  );
}
