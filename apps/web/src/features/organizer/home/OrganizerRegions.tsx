import type { RegionDto } from '@foodboll/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { useI18n } from '../../../i18n/I18nProvider';
import { regionLabel } from '../../../lib/match';
import { ButtonLink } from '../../../ui/Button';
import { EmptyState } from '../../../ui/EmptyState';
import { ErrorState } from '../../../ui/ErrorState';
import { MapPin } from '../../../ui/icons';
import { Skeleton } from '../../../ui/Skeleton';

interface Props {
  readonly isAdmin: boolean;
  readonly regions: UseQueryResult<{ items: RegionDto[] }>;
}

/** The regions the organizer may announce in, or the way to get one. Admins may announce anywhere. */
export function OrganizerRegions({ isAdmin, regions }: Props) {
  const { t } = useI18n();

  if (isAdmin) return <p className="muted small">{t('organizer.home.regionsAdmin')}</p>;
  if (regions.isPending) return <Skeleton height={40} />;
  if (regions.isError)
    return <ErrorState error={regions.error} onRetry={() => void regions.refetch()} />;

  const items = regions.data.items;
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<MapPin size={32} />}
        title={t('organizer.home.regionsEmptyTitle')}
        text={t('organizer.home.regionsEmptyText')}
        action={
          <ButtonLink variant="primary" to="/organizer/apply">
            {t('organizer.home.apply')}
          </ButtonLink>
        }
      />
    );
  }

  return (
    <section className="stack">
      <h2 className="section-title">{t('organizer.home.regionsTitle')}</h2>
      <ul className="organizer-regions">
        {items.map((region) => (
          <li key={region.id} className="organizer-region">
            <MapPin size={16} aria-hidden="true" />
            {regionLabel(region)}
          </li>
        ))}
      </ul>
      <ButtonLink variant="ghost" to="/organizer/apply" className="organizer-apply-more">
        {t('organizer.home.applyMore')}
      </ButtonLink>
    </section>
  );
}
