import type { OrganizerApplicationDto } from '@foodboll/contracts';
import { ApiError } from '../../../api/client';
import { useI18n } from '../../../i18n/I18nProvider';
import { regionLabel } from '../../../lib/match';
import { Alert } from '../../../ui/Alert';
import { Button } from '../../../ui/Button';
import { ErrorState } from '../../../ui/ErrorState';
import { Sheet } from '../../../ui/Sheet';
import { useToast } from '../../../ui/Toast';
import { useDecideApplication, useRefreshApplications, type ApplicationDecision } from './api';

export interface DecisionTarget {
  readonly application: OrganizerApplicationDto;
  readonly decision: ApplicationDecision;
}

/** Another admin got there first, or the application is gone: the card on screen is out of date. */
const isStale = (error: unknown): boolean =>
  error instanceof ApiError && (error.code === 'INVALID_STATE' || error.code === 'APPLICATION_NOT_FOUND');

function DecisionForm({ target, onClose }: { readonly target: DecisionTarget; readonly onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const refresh = useRefreshApplications();
  const { application, decision } = target;
  const mutation = useDecideApplication(decision);
  const approving = decision === 'approve';
  const params = { name: application.applicant.displayName, region: regionLabel(application.region) };
  const { error } = mutation;
  const alreadyDecided = error instanceof ApiError && error.code === 'INVALID_STATE';
  const stale = isStale(error);

  const confirm = () =>
    mutation.mutate(application.id, {
      onSuccess: () => {
        toast.show(t(approving ? 'adminPeople.applications.approved' : 'adminPeople.applications.rejected'));
        onClose();
      },
      onError: (failure) => {
        if (isStale(failure)) refresh();
      },
    });

  return (
    <div className="stack">
      <p>{t(approving ? 'adminPeople.applications.approveText' : 'adminPeople.applications.rejectText', params)}</p>
      {approving && application.region.parent === null && <p>{t('adminPeople.applications.approveProvince')}</p>}
      <p className="small muted">{t(approving ? 'adminPeople.applications.approveNotify' : 'adminPeople.applications.rejectNotify')}</p>

      {alreadyDecided && <Alert tone="warning">{t('adminPeople.applications.alreadyDecided')}</Alert>}
      {error && !alreadyDecided && <ErrorState error={error} />}

      {!stale && (
        <Button variant={approving ? 'primary' : 'danger'} block loading={mutation.isPending} onClick={confirm}>
          {t(approving ? 'adminPeople.applications.approve' : 'adminPeople.applications.reject')}
        </Button>
      )}
      <Button block onClick={onClose}>
        {t(stale ? 'common.close' : 'common.cancel')}
      </Button>
    </div>
  );
}

/** Confirms a decision before it is sent: both are final, and approving grants real permissions. */
export function DecisionSheet({ target, onClose }: { readonly target: DecisionTarget | null; readonly onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet
      open={target !== null}
      title={t(target?.decision === 'approve' ? 'adminPeople.applications.approveTitle' : 'adminPeople.applications.rejectTitle')}
      onClose={onClose}
    >
      {target && <DecisionForm target={target} onClose={onClose} />}
    </Sheet>
  );
}
