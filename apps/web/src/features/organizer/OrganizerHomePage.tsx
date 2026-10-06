import { useMe } from '../../api/queries';
import { useI18n } from '../../i18n/I18nProvider';
import { ButtonLink } from '../../ui/Button';
import { Plus } from '../../ui/icons';
import { PageHeader } from '../../ui/PageHeader';
import { Skeleton } from '../../ui/Skeleton';
import { useOrganizerRegions } from './api';
import { OrganizedMatches } from './home/OrganizedMatches';
import { OrganizerRegions } from './home/OrganizerRegions';
import { PaymentsNote } from './home/PaymentsNote';

export function OrganizerHomePage() {
  const { t } = useI18n();
  const me = useMe();
  const regions = useOrganizerRegions();
  const isAdmin = me.data?.role === 'ADMIN';
  const canAnnounce = isAdmin || (regions.data?.items.length ?? 0) > 0;

  return (
    <>
      <PageHeader back title={t('organizer.home.title')} />
      <div className="page">
        {canAnnounce ? (
          <ButtonLink variant="primary" size="lg" block to="/organizer/matches/new">
            <Plus size={20} aria-hidden="true" />
            {t('organizer.home.announce')}
          </ButtonLink>
        ) : (
          regions.isPending && <Skeleton height={52} />
        )}
        <OrganizerRegions isAdmin={isAdmin} regions={regions} />
        <PaymentsNote />
        <OrganizedMatches />
      </div>
    </>
  );
}
