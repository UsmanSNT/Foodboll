import type { AdminUserDto } from '@foodboll/contracts';
import { useI18n } from '../../../i18n/I18nProvider';
import { Avatar } from '../../../ui/Avatar';
import { ChevronRight } from '../../../ui/icons';
import { DeviceLocale, LanguageBadge, RoleBadge } from './UserBadges';

/** One person in the list. The whole row opens their organizer regions. */
export function UserRow({
  user,
  onOpen,
}: {
  readonly user: AdminUserDto;
  readonly onOpen: (user: AdminUserDto) => void;
}) {
  const { t } = useI18n();
  return (
    <li>
      <button
        type="button"
        className="list__item list__item--button people-user"
        aria-haspopup="dialog"
        onClick={() => onOpen(user)}
      >
        <Avatar name={user.displayName} id={user.id} />
        <span className="grow people-user__body">
          <span className="people-user__name">{user.displayName}</span>
          <span className="people-user__badges">
            <RoleBadge role={user.role} />
            <LanguageBadge language={user.preferredLanguage} />
            {user.role === 'ORGANIZER' && (
              <span className="small muted">
                {t('adminPeople.users.regionCount', { count: user.organizerRegions.length })}
              </span>
            )}
          </span>
          <DeviceLocale tag={user.deviceLocale} />
        </span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </li>
  );
}
