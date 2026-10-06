import {
  ORGANIZER_APPLICATION_STATUSES,
  type OrganizerApplicationStatus,
} from '@foodboll/contracts';
import { useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { CheckCircle2, ClipboardCheck } from '../../ui/icons';
import { EmptyState } from '../../ui/EmptyState';
import { PageHeader } from '../../ui/PageHeader';
import { Segmented } from '../../ui/Segmented';
import { ListSkeleton } from '../../ui/Skeleton';
import { useAdminApplications } from './people/api';
import { ApplicationCard } from './people/ApplicationCard';
import { DecisionSheet, type DecisionTarget } from './people/DecisionSheet';
import { InfiniteList } from './people/InfiniteList';
import { APPLICATION_EMPTY_KEY, APPLICATION_STATUS_LABEL_KEY } from './people/labels';

/** Organizer applications by status. Pending ones can be approved or rejected after a confirmation. */
export function AdminApplicationsPage() {
  const { t } = useI18n();
  const [status, setStatus] = useState<OrganizerApplicationStatus>('PENDING');
  const [target, setTarget] = useState<DecisionTarget | null>(null);
  const query = useAdminApplications(status);

  return (
    <>
      <PageHeader back title={t('adminPeople.applications.title')} />
      <div className="page">
        <Segmented
          label={t('adminPeople.applications.tabsLabel')}
          value={status}
          onChange={setStatus}
          options={ORGANIZER_APPLICATION_STATUSES.map((value) => ({
            value,
            label: t(APPLICATION_STATUS_LABEL_KEY[value]),
          }))}
        />
        <div className="stack" role="tabpanel" aria-label={t(APPLICATION_STATUS_LABEL_KEY[status])}>
          <InfiniteList
            query={query}
            skeleton={<ListSkeleton rows={3} height={168} />}
            empty={
              <EmptyState
                icon={
                  status === 'PENDING' ? <CheckCircle2 size={32} /> : <ClipboardCheck size={32} />
                }
                title={t(APPLICATION_EMPTY_KEY[status].title)}
                text={t(APPLICATION_EMPTY_KEY[status].text)}
              />
            }
          >
            {(applications) => (
              <ul className="stack">
                {applications.map((application) => (
                  <li key={application.id}>
                    <ApplicationCard
                      application={application}
                      onDecide={(decision) => setTarget({ application, decision })}
                    />
                  </li>
                ))}
              </ul>
            )}
          </InfiniteList>
        </div>
      </div>
      <DecisionSheet target={target} onClose={() => setTarget(null)} />
    </>
  );
}
