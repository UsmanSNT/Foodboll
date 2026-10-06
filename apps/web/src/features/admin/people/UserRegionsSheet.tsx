import type { AdminUserDto } from '@foodboll/contracts';
import { useRegionTree } from '../../../api/queries';
import { useI18n } from '../../../i18n/I18nProvider';
import { Alert } from '../../../ui/Alert';
import { Avatar } from '../../../ui/Avatar';
import { ErrorState } from '../../../ui/ErrorState';
import { Sheet } from '../../../ui/Sheet';
import { ListSkeleton } from '../../../ui/Skeleton';
import { RegionEditor } from './RegionEditor';
import { DeviceLocale, LanguageBadge, RoleBadge } from './UserBadges';

function UserSummary({ user }: { readonly user: AdminUserDto }) {
  const { t, formatDateLong } = useI18n();
  return (
    <div className="row people-summary">
      <Avatar name={user.displayName} id={user.id} size="lg" />
      <div className="grow people-user__body">
        <h3 className="people-user__name">{user.displayName}</h3>
        <span className="people-user__badges">
          <RoleBadge role={user.role} />
          <LanguageBadge language={user.preferredLanguage} />
        </span>
        <DeviceLocale tag={user.deviceLocale} />
        <span className="small muted">{t('adminPeople.users.joinedOn', { date: formatDateLong(user.createdAt) })}</span>
      </div>
    </div>
  );
}

/** Loads the region list, which only the editor needs: admins are never edited. */
function RegionsLoader({ user, onClose }: { readonly user: AdminUserDto; readonly onClose: () => void }) {
  const tree = useRegionTree();
  if (tree.isPending) return <ListSkeleton rows={4} height={52} />;
  if (tree.isError) return <ErrorState error={tree.error} onRetry={() => void tree.refetch()} />;
  return <RegionEditor user={user} tree={tree.data.items} onSaved={onClose} />;
}

function UserRegions({ user, onClose }: { readonly user: AdminUserDto; readonly onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div className="stack">
      <UserSummary user={user} />
      {user.role === 'ADMIN' ? <Alert tone="info">{t('adminPeople.regions.adminLocked')}</Alert> : <RegionsLoader user={user} onClose={onClose} />}
    </div>
  );
}

/** One person's organizer regions: where they may announce matches, editable by an admin. */
export function UserRegionsSheet({ user, onClose }: { readonly user: AdminUserDto | null; readonly onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet open={user !== null} title={t('adminPeople.regions.title')} onClose={onClose}>
      {user && <UserRegions user={user} onClose={onClose} />}
    </Sheet>
  );
}
