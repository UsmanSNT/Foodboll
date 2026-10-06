import type {
  MatchSummaryDto,
  OrganizerApplicationDto,
  Page,
  RegionDto,
  RosterEntryDto,
} from '@foodboll/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiRequest } from '../../api/client';
import { useApiMutation, useApiQuery } from '../../api/queries';
import { useI18n } from '../../i18n/I18nProvider';

const MATCHES_PAGE = 20;

/** Regions the signed-in organizer may announce matches in (a province covers its districts). */
export const useOrganizerRegions = () =>
  useApiQuery<{ items: RegionDto[] }>(['organizer-regions'], '/v1/me/organizer-regions');

/** The organizer's own matches, newest first. The match form invalidates the `organized-matches` key. */
export function useOrganizedMatches() {
  const { locale } = useI18n();
  return useInfiniteQuery({
    queryKey: ['organized-matches', locale],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      apiRequest<Page<MatchSummaryDto>>(
        `/v1/me/organized-matches?limit=${MATCHES_PAGE}&offset=${pageParam}`,
        { locale, signal },
      ),
    getNextPageParam: (last) =>
      last.items.length < MATCHES_PAGE ? undefined : last.offset + last.limit,
  });
}

export const useRoster = (matchId: string) =>
  useApiQuery<{ items: RosterEntryDto[] }>(
    ['roster', matchId],
    `/v1/matches/${encodeURIComponent(matchId)}/roster`,
  );

export interface AttendanceMark {
  readonly registrationId: string;
  readonly attended: boolean;
}

/** Saves marks, then refreshes the roster and the stats the marks feed into. */
export const useSaveAttendance = (matchId: string) =>
  useApiMutation<readonly AttendanceMark[], { items: RosterEntryDto[] }>(
    (marks) => ({
      path: `/v1/matches/${encodeURIComponent(matchId)}/attendance`,
      method: 'PUT',
      body: { marks },
    }),
    [['roster', matchId], ['player'], ['my-profile']],
  );

export const useMyApplications = () =>
  useApiQuery<{ items: OrganizerApplicationDto[] }>(
    ['organizer-applications'],
    '/v1/me/organizer-applications',
  );

export interface ApplicationInput {
  readonly regionCode: string;
  readonly message: string | null;
}

export const useApplyToOrganize = () =>
  useApiMutation<ApplicationInput, OrganizerApplicationDto>(
    (body) => ({ path: '/v1/organizer-applications', method: 'POST', body }),
    [['organizer-applications']],
  );
