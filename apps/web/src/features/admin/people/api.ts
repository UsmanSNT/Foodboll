import type {
  AdminUserDto,
  OrganizerApplicationDto,
  OrganizerApplicationStatus,
  Page,
} from '@foodboll/contracts';
import type { LocaleCode } from '@foodboll/i18n';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiRequest } from '../../../api/client';
import { useApiMutation } from '../../../api/queries';
import { useI18n } from '../../../i18n/I18nProvider';

const PAGE_SIZE = 20;

export const APPLICATIONS_KEY = ['admin-applications'] as const;
export const USERS_KEY = ['admin-users'] as const;

/** A full page means there may be more; a short one is the end of the list. */
function nextOffset(last: Page<unknown>): number | undefined {
  return last.items.length < PAGE_SIZE ? undefined : last.offset + last.limit;
}

/** Applications with one status, oldest first (the API's order: a fair queue to work through). */
export function useAdminApplications(status: OrganizerApplicationStatus) {
  const { locale } = useI18n();
  return useInfiniteQuery({
    queryKey: [...APPLICATIONS_KEY, status, locale],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        status,
        limit: String(PAGE_SIZE),
        offset: String(pageParam),
      });
      return apiRequest<Page<OrganizerApplicationDto>>(
        `/v1/admin/organizer-applications?${params}`,
        { locale, signal },
      );
    },
    getNextPageParam: nextOffset,
  });
}

export type ApplicationDecision = 'approve' | 'reject';

/** Approving also changes a role and a region grant, so the users list is refreshed too. */
export const useDecideApplication = (decision: ApplicationDecision) =>
  useApiMutation<string, OrganizerApplicationDto>(
    (id) => ({
      path: `/v1/admin/organizer-applications/${encodeURIComponent(id)}/${decision}`,
      method: 'POST',
    }),
    decision === 'approve' ? [APPLICATIONS_KEY, USERS_KEY] : [APPLICATIONS_KEY],
  );

/** For a decision that failed because the list was stale: show what is there now. */
export function useRefreshApplications(): () => void {
  const queryClient = useQueryClient();
  return useCallback(
    () => void queryClient.invalidateQueries({ queryKey: [...APPLICATIONS_KEY] }),
    [queryClient],
  );
}

/** `all` sends no filter; `none` is the users who never chose a language. */
export type UserLanguageFilter = 'all' | 'none' | LocaleCode;

export function useAdminUsers(language: UserLanguageFilter) {
  const { locale } = useI18n();
  return useInfiniteQuery({
    queryKey: [...USERS_KEY, language, locale],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(pageParam) });
      if (language !== 'all') params.set('language', language);
      return apiRequest<Page<AdminUserDto>>(`/v1/admin/users?${params}`, { locale, signal });
    },
    getNextPageParam: nextOffset,
  });
}

export interface OrganizerRegionsUpdate {
  readonly userId: string;
  readonly regionCodes: readonly string[];
}

/** Replaces the user's grants. The API changes their role with it, so the users list is refreshed. */
export const useSetOrganizerRegions = () =>
  useApiMutation<OrganizerRegionsUpdate, { organizerRegions: string[] }>(
    ({ userId, regionCodes }) => ({
      path: `/v1/admin/users/${encodeURIComponent(userId)}/organizer-regions`,
      method: 'PUT',
      body: { regionCodes },
    }),
    [USERS_KEY],
  );
