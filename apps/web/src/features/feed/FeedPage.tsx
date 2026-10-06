import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFeed, useNotifications } from '../../api/queries';
import { useAuth } from '../../auth/AuthProvider';
import { useLoginGate } from '../../auth/useRequireLogin';
import { useI18n } from '../../i18n/I18nProvider';
import { addDays, koreanDateKey } from '../../lib/dates';
import { groupByDay } from '../../lib/match';
import { RegionPicker, RegionPill } from '../../region/RegionPicker';
import { useRegion } from '../../region/RegionProvider';
import { useRegionLabel } from '../../region/useRegionLabel';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { Bell, Calendar } from '../../ui/icons';
import { Wordmark } from '../../ui/Logo';
import { Sheet } from '../../ui/Sheet';
import { ListSkeleton } from '../../ui/Skeleton';
import { MatchCard } from '../match/MatchCard';
import { DateStrip } from './DateStrip';

/** Home: the matches near you, day by day. */
export function FeedPage() {
  const { t, formatDate } = useI18n();
  const { signedIn } = useAuth();
  const { openLogin } = useLoginGate();
  const { region, resolving, choose } = useRegion();
  const regionLabel = useRegionLabel(region);
  const notifications = useNotifications();
  const [date, setDate] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const feed = useFeed({ region, date }, { enabled: !resolving });

  const groups = useMemo(
    () => groupByDay(feed.data?.pages.flatMap((page) => page.items) ?? []),
    [feed.data],
  );
  const today = koreanDateKey(new Date());
  const unread = signedIn ? (notifications.data?.unread ?? 0) : 0;

  const dayTitle = (key: string) =>
    key === today
      ? `${t('feed.today')} · ${formatDate(`${key}T12:00:00+09:00`)}`
      : key === addDays(today, 1)
        ? `${t('feed.tomorrow')} · ${formatDate(`${key}T12:00:00+09:00`)}`
        : formatDate(`${key}T12:00:00+09:00`);

  return (
    <>
      <header className="feed-head">
        <div className="row row--between">
          <Wordmark />
          {signedIn ? (
            <Link
              to="/notifications"
              className="btn btn--ghost btn--icon bell"
              aria-label={t('inbox.title')}
            >
              <Bell size={22} aria-hidden="true" />
              {unread > 0 && (
                <span
                  className="bell__dot"
                  role="img"
                  aria-label={t('inbox.unread', { count: unread })}
                />
              )}
            </Link>
          ) : (
            <Button size="sm" variant="primary" onClick={openLogin}>
              {t('auth.login')}
            </Button>
          )}
        </div>
        <RegionPill label={regionLabel} onClick={() => setPicking(true)} />
        <DateStrip value={date} onChange={setDate} />
      </header>

      <div className="page">
        {feed.isPending && <ListSkeleton />}
        {feed.isError && <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />}

        {feed.isSuccess && groups.length === 0 && (
          <EmptyState
            icon={<Calendar size={32} />}
            title={t('feed.empty')}
            text={t('feed.emptyHint')}
            action={
              region !== null || date !== null ? (
                <Button
                  onClick={() => {
                    setDate(null);
                    void choose(null);
                  }}
                >
                  {t('feed.emptyAction')}
                </Button>
              ) : undefined
            }
          />
        )}

        {groups.map((group) => (
          <section key={group.key} className="stack" aria-labelledby={`day-${group.key}`}>
            <h2 id={`day-${group.key}`} className="section-title">
              {dayTitle(group.key)}
            </h2>
            {group.items.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </section>
        ))}

        {feed.hasNextPage && (
          <Button block loading={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
            {t('feed.loadMore')}
          </Button>
        )}
      </div>

      <Sheet open={picking} title={t('region.title')} onClose={() => setPicking(false)}>
        <RegionPicker
          current={region}
          allowAll
          onSelect={(code) => {
            void choose(code);
            setPicking(false);
          }}
        />
      </Sheet>
    </>
  );
}
