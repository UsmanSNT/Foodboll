import type {
  AuthTokenDto,
  MatchDto,
  MeDto,
  NotificationPage,
  Page,
  PaymentInstructionDto,
  PlayerCardDto,
  PlayerProfileDto,
  RegionNodeDto,
  RegistrationDto,
  LegalDocumentDto,
  MatchSummaryDto,
  LanguageDto,
} from '@foodboll/contracts';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n/I18nProvider';
import { apiRequest } from './client';

/**
 * Typed data hooks. Every read is keyed by the UI language, because the server renders content
 * (titles, region names, notifications) in the reader's language.
 */
export function useApiQuery<T>(
  key: readonly unknown[],
  path: string,
  options: Partial<Pick<UseQueryOptions<T>, 'enabled' | 'staleTime' | 'placeholderData' | 'refetchInterval'>> = {},
) {
  const { locale } = useI18n();
  return useQuery<T>({
    queryKey: [...key, locale],
    queryFn: ({ signal }) => apiRequest<T>(path, { locale, signal }),
    ...options,
  });
}

export const useLanguages = () => useApiQuery<{ items: LanguageDto[] }>(['languages'], '/v1/languages', { staleTime: 3_600_000 });

export function useMe() {
  const { signedIn } = useAuth();
  return useApiQuery<MeDto>(['me'], '/v1/me', { enabled: signedIn, staleTime: 60_000 });
}

export const useRegionTree = () =>
  useApiQuery<{ items: RegionNodeDto[] }>(['regions'], '/v1/regions', { staleTime: 60_000 });

export interface FeedFilter {
  readonly region: string | null;
  /** `YYYY-MM-DD` in Korean time, or null for every upcoming day. */
  readonly date: string | null;
}

const FEED_PAGE = 20;

export function useFeed(filter: FeedFilter, options: { enabled?: boolean } = {}) {
  const { locale } = useI18n();
  const { token } = useAuth();
  return useInfiniteQuery({
    queryKey: ['feed', filter.region, filter.date, locale, token !== null],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: String(FEED_PAGE), offset: String(pageParam) });
      if (filter.region) params.set('region', filter.region);
      if (filter.date) params.set('date', filter.date);
      return apiRequest<Page<MatchSummaryDto>>(`/v1/matches?${params}`, { locale, signal });
    },
    getNextPageParam: (last) => (last.items.length < FEED_PAGE ? undefined : last.offset + last.limit),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useMatch(id: string) {
  const { token } = useAuth();
  return useApiQuery<MatchDto>(['match', id, token !== null], `/v1/matches/${encodeURIComponent(id)}`);
}

export function useMatchPlayers(id: string) {
  const { signedIn } = useAuth();
  return useApiQuery<{ items: PlayerCardDto[] }>(['match-players', id], `/v1/matches/${encodeURIComponent(id)}/players`, {
    enabled: signedIn,
  });
}

export function useMyRegistrations() {
  const { signedIn } = useAuth();
  return useApiQuery<Page<RegistrationDto>>(['registrations'], '/v1/me/registrations?limit=100', { enabled: signedIn });
}

/** One registration. While payment is still expected it refreshes, so an automatic confirmation appears on its own. */
export function useRegistration(id: string) {
  const { signedIn } = useAuth();
  return useApiQuery<RegistrationDto>(['registration', id], `/v1/registrations/${encodeURIComponent(id)}`, {
    enabled: signedIn,
    refetchInterval: (query) => (query.state.data?.status === 'APPLIED' ? 15_000 : false),
  });
}

export const useMyProfile = () => {
  const { signedIn } = useAuth();
  return useApiQuery<PlayerProfileDto>(['my-profile'], '/v1/me/profile', { enabled: signedIn });
};

export const usePaymentInstruction = (enabled: boolean) =>
  useApiQuery<PaymentInstructionDto>(['payment-instruction'], '/v1/payment-instructions/current', { enabled });

export const usePlayerProfile = (id: string) =>
  useApiQuery<PlayerProfileDto>(['player', id], `/v1/players/${encodeURIComponent(id)}`);

export function usePlayerSearch(q: string, region: string | null) {
  const { signedIn } = useAuth();
  const params = new URLSearchParams({ limit: '30' });
  if (q.trim()) params.set('q', q.trim());
  if (region) params.set('region', region);
  return useApiQuery<Page<PlayerCardDto>>(['players', q.trim(), region], `/v1/players?${params}`, {
    enabled: signedIn,
    placeholderData: keepPreviousData,
  });
}

export function useNotifications() {
  const { signedIn } = useAuth();
  return useApiQuery<NotificationPage>(['notifications'], '/v1/me/notifications?limit=50', {
    enabled: signedIn,
    refetchInterval: 60_000,
  });
}

export const useLegalDocument = (type: string) =>
  useApiQuery<LegalDocumentDto>(['legal', type], `/v1/legal/${type}`);

export interface TelegramStatus {
  readonly available: boolean;
  readonly linked: boolean;
  readonly notificationsEnabled: boolean;
  readonly botLink: string | null;
}
export function useTelegramStatus() {
  const { signedIn } = useAuth();
  return useApiQuery<TelegramStatus>(['telegram'], '/v1/me/telegram', { enabled: signedIn });
}

export interface AuthConfig {
  readonly telegramBotUsername: string | null;
  readonly devLogin: boolean;
}
export const useAuthConfig = () => useApiQuery<AuthConfig>(['auth-config'], '/v1/auth/config', { staleTime: 3_600_000 });

// ---- Mutations ---------------------------------------------------------------------------

/** Runs a write and refreshes whatever it may have changed. */
export function useApiMutation<TBody, TResult = unknown>(
  build: (body: TBody, locale: ReturnType<typeof useI18n>['locale']) => { path: string; method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; file?: File },
  invalidate: readonly (readonly unknown[])[] = [],
) {
  const { locale } = useI18n();
  const queryClient = useQueryClient();
  return useMutation<TResult, Error, TBody>({
    mutationFn: (body) => {
      const request = build(body, locale);
      return apiRequest<TResult>(request.path, {
        method: request.method,
        locale,
        ...(request.body !== undefined && { body: request.body }),
        ...(request.file && { file: request.file }),
      });
    },
    onSuccess: async () => {
      await Promise.all(invalidate.map((key) => queryClient.invalidateQueries({ queryKey: [...key] })));
    },
  });
}

export const useDevLogin = () =>
  useMutation<AuthTokenDto, Error, { name: string; role: 'PLAYER' | 'ORGANIZER' | 'ADMIN' }>({
    mutationFn: (body) => apiRequest<AuthTokenDto>('/v1/auth/dev-login', { method: 'POST', body }),
  });

export const useTelegramLogin = () =>
  useMutation<AuthTokenDto, Error, Record<string, unknown>>({
    mutationFn: (body) => apiRequest<AuthTokenDto>('/v1/auth/telegram', { method: 'POST', body }),
  });
