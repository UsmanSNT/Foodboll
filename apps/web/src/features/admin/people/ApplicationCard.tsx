import type { OrganizerApplicationDto } from '@foodboll/contracts';
import { useI18n } from '../../../i18n/I18nProvider';
import { regionLabel } from '../../../lib/match';
import { Avatar } from '../../../ui/Avatar';
import { Badge } from '../../../ui/Badge';
import { Button } from '../../../ui/Button';
import { MapPin } from '../../../ui/icons';
import type { ApplicationDecision } from './api';
import { APPLICATION_STATUS_LABEL_KEY, APPLICATION_STATUS_TONE } from './labels';

interface Props {
  readonly application: OrganizerApplicationDto;
  readonly onDecide: (decision: ApplicationDecision) => void;
}

/** One application: who, where, what they wrote, and (while pending) the two decisions. */
export function ApplicationCard({ application, onDecide }: Props) {
  const { t, formatDateLong } = useI18n();
  const { applicant, region, message, status } = application;
  const titleId = `application-${application.id}`;
  const action = (key: 'adminPeople.applications.approve' | 'adminPeople.applications.reject') =>
    t('adminPeople.applications.actionFor', { action: t(key), name: applicant.displayName });

  return (
    <article className="card card--pad stack people-app" aria-labelledby={titleId}>
      <div className="row people-app__head">
        <Avatar name={applicant.displayName} id={applicant.id} />
        <div className="grow">
          <h3 id={titleId} className="people-app__name">
            {applicant.displayName}
          </h3>
          <p className="small muted people-app__region">
            <MapPin size={14} aria-hidden="true" />
            <span lang={region.name.locale}>{regionLabel(region)}</span>
          </p>
        </div>
        {status !== 'PENDING' && (
          <Badge tone={APPLICATION_STATUS_TONE[status]}>
            {t(APPLICATION_STATUS_LABEL_KEY[status])}
          </Badge>
        )}
      </div>

      {message ? (
        <p className="prewrap people-app__message">{message}</p>
      ) : (
        <p className="small muted">{t('adminPeople.applications.noMessage')}</p>
      )}

      <p className="small muted">
        {t('adminPeople.applications.appliedOn', { date: formatDateLong(application.createdAt) })}
        {application.reviewedAt &&
          ` · ${t('adminPeople.applications.reviewedOn', { date: formatDateLong(application.reviewedAt) })}`}
      </p>

      {status === 'PENDING' && (
        <div className="people-actions">
          <Button
            variant="danger"
            aria-label={action('adminPeople.applications.reject')}
            onClick={() => onDecide('reject')}
          >
            {t('adminPeople.applications.reject')}
          </Button>
          <Button
            variant="primary"
            aria-label={action('adminPeople.applications.approve')}
            onClick={() => onDecide('approve')}
          >
            {t('adminPeople.applications.approve')}
          </Button>
        </div>
      )}
    </article>
  );
}
