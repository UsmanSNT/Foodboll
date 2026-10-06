import type { AdminUserDto } from '@foodboll/contracts';
import { useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { EmptyState } from '../../ui/EmptyState';
import { Users } from '../../ui/icons';
import { PageHeader } from '../../ui/PageHeader';
import { ListSkeleton } from '../../ui/Skeleton';
import { useAdminUsers, type UserLanguageFilter } from './people/api';
import { InfiniteList } from './people/InfiniteList';
import { LanguageFilter } from './people/LanguageFilter';
import { UserRegionsSheet } from './people/UserRegionsSheet';
import { UserRow } from './people/UserRow';

/** Everyone who signed up, newest first, filterable by language. Tapping a person manages their organizer regions. */
export function AdminUsersPage() {
  const { t } = useI18n();
  const [language, setLanguage] = useState<UserLanguageFilter>('all');
  const [selected, setSelected] = useState<AdminUserDto | null>(null);
  const query = useAdminUsers(language);

  return (
    <>
      <PageHeader back title={t('adminPeople.users.title')} />
      <div className="page">
        <LanguageFilter value={language} onChange={setLanguage} />
        <InfiniteList
          query={query}
          skeleton={<ListSkeleton rows={6} height={76} />}
          empty={
            <EmptyState
              icon={<Users size={32} />}
              title={t('adminPeople.users.emptyTitle')}
              text={t(
                language === 'all'
                  ? 'adminPeople.users.emptyText'
                  : 'adminPeople.users.emptyFilteredText',
              )}
            />
          }
        >
          {(users) => (
            <ul className="card list people-users">
              {users.map((user) => (
                <UserRow key={user.id} user={user} onOpen={setSelected} />
              ))}
            </ul>
          )}
        </InfiniteList>
      </div>
      <UserRegionsSheet user={selected} onClose={() => setSelected(null)} />
    </>
  );
}
