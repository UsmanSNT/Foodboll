import { useI18n } from '../../../i18n/I18nProvider';
import { regionLabel } from '../../../lib/match';
import { Badge } from '../../../ui/Badge';
import { ErrorState } from '../../../ui/ErrorState';
import { ListSkeleton } from '../../../ui/Skeleton';
import { useMyApplications } from '../api';
import { APPLICATION_STATUS_LABEL_KEY, APPLICATION_STATUS_TONE } from './application-status';

/** The person's own applications, newest first, each with its review status. */
export function ApplicationList() {
  const { t, formatDateLong } = useI18n();
  const query = useMyApplications();

  return (
    <section className="stack">
      <h2 className="section-title">{t('organizer.apply.mine')}</h2>
      {query.isPending && <ListSkeleton rows={2} height={92} />}
      {query.isError && !query.data && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data?.items.length === 0 && <p className="muted">{t('organizer.apply.mineEmpty')}</p>}
      {query.data && query.data.items.length > 0 && (
        <ul className="stack">
          {query.data.items.map((application) => (
            <li key={application.id} className="card card--pad stack application">
              <div className="row row--between">
                <h3 className="grow">{regionLabel(application.region)}</h3>
                <Badge tone={APPLICATION_STATUS_TONE[application.status]}>{t(APPLICATION_STATUS_LABEL_KEY[application.status])}</Badge>
              </div>
              {application.message && <p className="prewrap small">{application.message}</p>}
              <p className="small muted">
                {t('organizer.apply.appliedOn', { date: formatDateLong(application.createdAt) })}
                {application.reviewedAt && ` · ${t('organizer.apply.reviewedOn', { date: formatDateLong(application.reviewedAt) })}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
