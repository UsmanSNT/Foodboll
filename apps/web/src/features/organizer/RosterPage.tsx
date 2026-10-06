import type { MatchDto } from '@foodboll/contracts';
import { useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { useMatch } from '../../api/queries';
import { useI18n } from '../../i18n/I18nProvider';
import { ErrorState } from '../../ui/ErrorState';
import { PageHeader } from '../../ui/PageHeader';
import { ListSkeleton, Skeleton } from '../../ui/Skeleton';
import { MatchFacts } from '../match/MatchFacts';
import { useRoster } from './api';
import { AttendanceList } from './home/AttendanceList';

/** A missing match or someone else's roster cannot be fixed by trying again. */
const isFinal = (error: unknown) => error instanceof ApiError && (error.code === 'MATCH_NOT_FOUND' || error.code === 'FORBIDDEN');

function MatchHeading({ match }: { readonly match: MatchDto }) {
  return (
    <section className="card card--pad stack roster-match">
      <h2 lang={match.title.locale}>{match.title.text}</h2>
      <MatchFacts match={match} />
    </section>
  );
}

export function RosterPage() {
  const { t } = useI18n();
  const { id = '' } = useParams();
  const match = useMatch(id);
  const roster = useRoster(id);
  const header = <PageHeader back title={t('organizer.roster.title')} />;

  if (match.isError && !match.data) {
    return (
      <>
        {header}
        <div className="page">
          <ErrorState error={match.error} {...(!isFinal(match.error) && { onRetry: () => void match.refetch() })} />
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="page page--with-cta">
        {match.data ? <MatchHeading match={match.data} /> : <Skeleton height={104} />}
        {match.data && roster.data ? (
          <AttendanceList key={id} match={match.data} entries={roster.data.items} onStale={() => void roster.refetch()} />
        ) : roster.isError ? (
          <ErrorState error={roster.error} {...(!isFinal(roster.error) && { onRetry: () => void roster.refetch() })} />
        ) : (
          <ListSkeleton rows={4} height={104} />
        )}
      </div>
    </>
  );
}
