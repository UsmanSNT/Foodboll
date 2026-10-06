import { useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { usePlayerProfile } from '../../api/queries';
import { useAuth } from '../../auth/AuthProvider';
import { useLoginGate } from '../../auth/useRequireLogin';
import { useI18n } from '../../i18n/I18nProvider';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { Users } from '../../ui/icons';
import { PageHeader } from '../../ui/PageHeader';
import { ListSkeleton } from '../../ui/Skeleton';
import { ProfileView } from './ProfileView';

export function PlayerProfilePage() {
  const { t } = useI18n();
  const { signedIn } = useAuth();
  const { openLogin } = useLoginGate();
  const { id = '' } = useParams();
  const profile = usePlayerProfile(id);

  const header = <PageHeader back title={t('profile.title')} />;
  if (!signedIn) {
    return (
      <>
        {header}
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
  if (profile.isPending) {
    return (
      <>
        {header}
        <div className="page">
          <ListSkeleton rows={3} height={150} />
        </div>
      </>
    );
  }
  if (profile.isError) {
    const missing = profile.error instanceof ApiError && profile.error.code === 'PLAYER_NOT_FOUND';
    return (
      <>
        {header}
        <div className="page">
          <ErrorState
            error={profile.error}
            {...(missing ? {} : { onRetry: () => void profile.refetch() })}
          />
        </div>
      </>
    );
  }
  return (
    <>
      {header}
      <ProfileView profile={profile.data} />
    </>
  );
}
