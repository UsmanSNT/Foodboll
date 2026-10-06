import type { MatchTranslationsDto, RegionNodeDto } from '@foodboll/contracts';
import type { LocaleCode } from '@foodboll/i18n';
import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { useMe, useRegionTree } from '../../api/queries';
import { useI18n } from '../../i18n/I18nProvider';
import { hasStarted } from '../../lib/match';
import { ButtonLink } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { Flag } from '../../ui/icons';
import { PageHeader } from '../../ui/PageHeader';
import { ListSkeleton } from '../../ui/Skeleton';
import { useMatchTranslations, useOrganizerRegions } from './match-form/api';
import { createInitialState, stateFromMatch, type FormState } from './match-form/form-state';
import { MatchForm } from './match-form/MatchForm';
import { allowedRegionGroups, findRegion, onlyChoice, type RegionGroup } from './match-form/regions';

/** An edited match starts from what is saved; a new one from the organizer's language and, if there is just one, their only region. */
function initialState(
  saved: MatchTranslationsDto | undefined,
  tree: readonly RegionNodeDto[],
  regions: readonly RegionGroup[],
  language: LocaleCode,
): FormState {
  if (!saved) return createInitialState({ language, regionCode: onlyChoice(regions) });
  const state = stateFromMatch(saved);
  // A region that has since been switched off cannot be kept: the organizer picks again.
  return state.regionCode !== null && !findRegion(tree, state.regionCode) ? { ...state, regionCode: null } : state;
}

/** Announce a new match (`/organizer/matches/new`) or edit one (`/organizer/matches/:id/edit`). */
export function MatchFormPage() {
  const { t, locale } = useI18n();
  const { id } = useParams();
  const me = useMe();
  const isAdmin = me.data?.role === 'ADMIN';
  const tree = useRegionTree();
  // Admins may announce anywhere; organizers only in the regions they were granted.
  const grants = useOrganizerRegions(me.data !== undefined && !isAdmin);
  const saved = useMatchTranslations(id);

  const header = <PageHeader back title={t(id === undefined ? 'matchForm.titleNew' : 'matchForm.titleEdit')} />;
  const page = (content: ReactNode) => (
    <>
      {header}
      <div className="page">{content}</div>
    </>
  );

  // A failed background refresh must not replace a form that is already on screen.
  const failed = [me, tree, ...(isAdmin ? [] : [grants]), ...(id === undefined ? [] : [saved])].find(
    (query) => query.isError && query.data === undefined,
  );
  if (failed) {
    // A match that is missing or not yours will not appear by retrying.
    const retryable = !(failed.error instanceof ApiError) || failed.error.status === 0 || failed.error.status >= 500;
    return page(<ErrorState error={failed.error} {...(retryable && { onRetry: () => void failed.refetch() })} />);
  }
  if (!me.data || !tree.data || (!isAdmin && !grants.data) || (id !== undefined && !saved.data)) {
    return page(<ListSkeleton rows={3} height={140} />);
  }

  const regions = allowedRegionGroups(tree.data.items, isAdmin ? null : (grants.data?.items ?? []));
  if (regions.length === 0) {
    return page(
      <EmptyState
        icon={<Flag size={32} />}
        title={t('matchForm.region.noneTitle')}
        text={t('matchForm.region.noneText')}
        action={
          <ButtonLink variant="primary" to="/organizer/apply">
            {t('matchForm.region.noneAction')}
          </ButtonLink>
        }
      />,
    );
  }

  return (
    <MatchForm
      matchId={id}
      initial={initialState(saved.data, tree.data.items, regions, locale)}
      tree={tree.data.items}
      regions={regions}
      locked={saved.data ? hasStarted(saved.data) : false}
    />
  );
}
