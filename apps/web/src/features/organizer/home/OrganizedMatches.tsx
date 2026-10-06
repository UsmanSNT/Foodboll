import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../i18n/I18nProvider';
import { Button } from '../../../ui/Button';
import { EmptyState } from '../../../ui/EmptyState';
import { ErrorState } from '../../../ui/ErrorState';
import { Calendar } from '../../../ui/icons';
import { Segmented } from '../../../ui/Segmented';
import { ListSkeleton } from '../../../ui/Skeleton';
import { useOrganizedMatches } from '../api';
import { OrganizedMatchCard } from './OrganizedMatchCard';
import { splitOrganizedMatches } from './organized-matches';
import { useNow } from './useNow';

type Tab = 'upcoming' | 'past';

/** The organizer's announced matches in Upcoming / Past tabs. */
export function OrganizedMatches() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('upcoming');
  const {
    data,
    isPending,
    isError,
    error,
    refetch,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useOrganizedMatches();
  const now = useNow();
  const { upcoming, past } = useMemo(
    () => splitOrganizedMatches(data?.pages ?? [], now),
    [data, now],
  );
  const list = tab === 'upcoming' ? upcoming : past;

  // The API lists the newest match first, so upcoming matches come before any finished one: once a
  // finished match has loaded, every upcoming match is on screen. Until then keep loading, so
  // "soonest first" is true however many matches are announced.
  const upcomingComplete = !hasNextPage || past.length > 0;
  const loadMoreUpcoming = !upcomingComplete && !isFetchingNextPage && !isFetchNextPageError;
  useEffect(() => {
    if (loadMoreUpcoming) void fetchNextPage();
  }, [loadMoreUpcoming, fetchNextPage]);
  const listComplete = tab === 'upcoming' ? upcomingComplete : !hasNextPage;

  return (
    <section className="stack">
      <h2 className="section-title">{t('organizer.home.matchesTitle')}</h2>
      <Segmented
        label={t('organizer.home.matchesTitle')}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'upcoming', label: t('myMatches.upcoming') },
          { value: 'past', label: t('myMatches.past') },
        ]}
      />

      {isPending && <ListSkeleton rows={2} height={176} />}
      {isError && !data && <ErrorState error={error} onRetry={() => void refetch()} />}

      {data && list.length === 0 && listComplete && (
        <EmptyState
          icon={<Calendar size={32} />}
          title={tab === 'upcoming' ? t('myMatches.emptyUpcoming') : t('myMatches.emptyPast')}
          text={
            tab === 'upcoming'
              ? t('organizer.home.emptyUpcomingText')
              : t('organizer.home.emptyPastText')
          }
        />
      )}

      {list.map((match) => (
        <OrganizedMatchCard key={match.id} match={match} now={now} />
      ))}

      {tab === 'upcoming' && isFetchingNextPage && <ListSkeleton rows={1} height={176} />}
      {isFetchNextPageError && <ErrorState error={error} onRetry={() => void fetchNextPage()} />}
      {tab === 'past' && hasNextPage && !isFetchNextPageError && (
        <Button block loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>
          {t('feed.loadMore')}
        </Button>
      )}
    </section>
  );
}
