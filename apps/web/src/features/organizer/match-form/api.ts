import type { MatchDto, MatchInput, MatchTranslationsDto, RegionDto } from '@foodboll/contracts';
import { useApiMutation, useApiQuery } from '../../../api/queries';

/** The regions the signed-in organizer was granted (a province grant covers its districts). */
export const useOrganizerRegions = (enabled: boolean) =>
  useApiQuery<{ items: RegionDto[] }>(['organizer-regions'], '/v1/me/organizer-regions', {
    enabled,
  });

/** The raw per-language texts of a match, for the editor. */
export const useMatchTranslations = (id: string | undefined) =>
  useApiQuery<MatchTranslationsDto>(
    ['match-translations', id],
    `/v1/matches/${encodeURIComponent(id ?? '')}/translations`,
    { enabled: id !== undefined },
  );

/** Creates a match, or replaces the one with `id`; everything that shows matches is refreshed. */
export const useSaveMatch = (id: string | undefined) =>
  useApiMutation<MatchInput, MatchDto>(
    (body) =>
      id === undefined
        ? { path: '/v1/matches', method: 'POST', body }
        : { path: `/v1/matches/${encodeURIComponent(id)}`, method: 'PUT', body },
    [['feed'], ['match'], ['organized-matches'], ['match-translations']],
  );
