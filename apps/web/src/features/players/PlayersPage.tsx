import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePlayerSearch } from '../../api/queries';
import { useAuth } from '../../auth/AuthProvider';
import { useLoginGate } from '../../auth/useRequireLogin';
import { useI18n } from '../../i18n/I18nProvider';
import { Avatar } from '../../ui/Avatar';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { TextInput } from '../../ui/Field';
import { ChevronRight, Search, Users } from '../../ui/icons';
import { PageHeader } from '../../ui/PageHeader';
import { ListSkeleton } from '../../ui/Skeleton';
import { regionLabel } from '../../lib/match';

/** Debounces typing so the API is queried once the player pauses, not on every keystroke. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function PlayersPage() {
  const { t } = useI18n();
  const { signedIn } = useAuth();
  const { openLogin } = useLoginGate();
  const [query, setQuery] = useState('');
  const search = usePlayerSearch(useDebounced(query, 250), null);

  if (!signedIn) {
    return (
      <>
        <PageHeader title={t('nav.players')} />
        <div className="page">
          <EmptyState
            icon={<Users size={32} />}
            title={t('players.loginRequired')}
            action={
              <Button variant="primary" onClick={openLogin}>
                {t('auth.login')}
              </Button>
            }
          />
        </div>
      </>
    );
  }

  const items = search.data?.items ?? [];
  return (
    <>
      <PageHeader title={t('profile.search')} />
      <div className="page">
        <div className="search">
          <Search size={18} aria-hidden="true" />
          <TextInput
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('profile.searchPlaceholder')}
            aria-label={t('profile.searchPlaceholder')}
            autoComplete="off"
            maxLength={60}
          />
        </div>
        {search.isPending && <ListSkeleton rows={4} height={64} />}
        {search.isError && (
          <ErrorState error={search.error} onRetry={() => void search.refetch()} />
        )}
        {search.isSuccess && items.length === 0 && (
          <EmptyState icon={<Users size={32} />} title={t('profile.noResults')} />
        )}
        {items.length > 0 && (
          <ul className="card list">
            {items.map((player) => (
              <li key={player.id}>
                <Link to={`/players/${player.id}`} className="list__item">
                  <Avatar name={player.displayName} id={player.id} />
                  <span className="grow">
                    <strong>{player.displayName}</strong>
                    {player.homeRegion && (
                      <small className="muted block">{regionLabel(player.homeRegion)}</small>
                    )}
                  </span>
                  <Badge tone="primary">
                    {t('stats.levelValue', { level: player.level.level })}
                  </Badge>
                  <ChevronRight size={16} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
