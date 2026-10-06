import type {
  AdminPaymentDto,
  ApiErrorBody,
  BankDepositDto,
  BankDepositStatus,
  Page,
  PaymentRejectReason,
  PaymentStatus,
} from '@foodboll/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ApiError, apiRequest, UNAUTHORIZED_EVENT } from '../../../api/client';
import { useApiMutation } from '../../../api/queries';
import { useI18n } from '../../../i18n/I18nProvider';
import { readAccessToken } from '../../../i18n/storage';
import { mergeDepositPages } from './deposit-pages';
import { uniqueBy } from './lists';

/** Everything below shares these key prefixes, so one invalidation refreshes a whole queue. */
export const PAYMENTS_KEY = ['admin-payments'] as const;
export const DEPOSITS_KEY = ['admin-deposits'] as const;
/** Resolving a payment changes payment queues only; resolving a deposit also changes the payments it settles. */
export const PAYMENT_QUEUES = [PAYMENTS_KEY];
export const DEPOSIT_QUEUES = [DEPOSITS_KEY, PAYMENTS_KEY];

const PAGE_SIZE = 20;

export type DepositTab = 'needs' | 'matched' | 'ignored';

/** The API lists one status per request, so the "needs a decision" tab reads two queues. */
export const DEPOSIT_TAB_STATUSES = {
  needs: ['UNMATCHED', 'AMBIGUOUS'],
  matched: ['MATCHED'],
  ignored: ['IGNORED'],
} as const satisfies Record<DepositTab, readonly BankDepositStatus[]>;

// ---- Payments ----------------------------------------------------------------------------

export function useAdminPayments(status: PaymentStatus) {
  const { locale } = useI18n();
  return useInfiniteQuery({
    queryKey: [...PAYMENTS_KEY, 'list', status, locale],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        status,
        limit: String(PAGE_SIZE),
        offset: String(pageParam),
      });
      return apiRequest<Page<AdminPaymentDto>>(`/v1/admin/payments?${params}`, { locale, signal });
    },
    getNextPageParam: (last) =>
      last.items.length < PAGE_SIZE ? undefined : last.offset + last.limit,
  });
}

const paymentPath = (registrationId: string, action: 'confirm' | 'reject' | 'refund') =>
  `/v1/admin/registrations/${encodeURIComponent(registrationId)}/payment/${action}`;

export const useConfirmPayment = () =>
  useApiMutation<string, AdminPaymentDto>((registrationId) => ({
    path: paymentPath(registrationId, 'confirm'),
    method: 'POST',
  }));

export const useRejectPayment = (registrationId: string) =>
  useApiMutation<PaymentRejectReason, AdminPaymentDto>((reason) => ({
    path: paymentPath(registrationId, 'reject'),
    method: 'POST',
    body: { reason },
  }));

export const useRefundPayment = (registrationId: string) =>
  useApiMutation<void, AdminPaymentDto>(() => ({
    path: paymentPath(registrationId, 'refund'),
    method: 'POST',
  }));

// ---- Receipts ----------------------------------------------------------------------------

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
const RECEIPT_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'application/pdf'];

/**
 * The receipt endpoint needs the Authorization header, so it cannot be an `<img src>`: the bytes
 * are fetched with the session token and shown through an object URL. Receipts are sensitive and
 * the server marks them `no-store`, so nothing here may be cached either.
 */
export async function fetchReceipt(registrationId: string, signal: AbortSignal): Promise<Blob> {
  const token = readAccessToken();
  const url = new URL(
    `${BASE_URL}/v1/registrations/${encodeURIComponent(registrationId)}/receipt`,
    window.location.origin,
  );
  let response: Response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('NETWORK_ERROR', 0);
  }
  if (response.status === 401 && token) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!response.ok) {
    const parsed = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(parsed?.error.code ?? 'INTERNAL_ERROR', response.status);
  }
  const blob = await response.blob();
  // Only the three formats players can upload are ever rendered.
  if (!RECEIPT_TYPES.includes(blob.type)) throw new ApiError('INVALID_RECEIPT', 422);
  return blob;
}

// ---- Assignment candidates ---------------------------------------------------------------

/** Payments a deposit can settle by hand: still waiting, or waiting for a person to review. */
const CANDIDATE_STATUSES = [
  'AWAITING_PAYMENT',
  'PAYMENT_REVIEW',
] as const satisfies readonly PaymentStatus[];
const CANDIDATE_PAGE = 100;
const CANDIDATE_PAGES_MAX = 10;

export interface CandidatePool {
  readonly items: readonly AdminPaymentDto[];
  /** True when the queues were longer than what is loaded, so some registrations are missing. */
  readonly truncated: boolean;
}

async function loadCandidates(
  status: PaymentStatus,
  locale: ReturnType<typeof useI18n>['locale'],
  signal: AbortSignal,
): Promise<CandidatePool> {
  const items: AdminPaymentDto[] = [];
  for (let page = 0; page < CANDIDATE_PAGES_MAX; page += 1) {
    const params = new URLSearchParams({
      status,
      limit: String(CANDIDATE_PAGE),
      offset: String(page * CANDIDATE_PAGE),
    });
    const result = await apiRequest<Page<AdminPaymentDto>>(`/v1/admin/payments?${params}`, {
      locale,
      signal,
    });
    items.push(...result.items);
    if (result.items.length < CANDIDATE_PAGE) return { items, truncated: false };
  }
  return { items, truncated: true };
}

/**
 * Every payment a deposit could belong to. The API has no search or amount filter and lists the
 * oldest first, so the whole queue is read (up to a limit) and filtered on the device.
 */
export function useAssignCandidates(enabled: boolean) {
  const { locale } = useI18n();
  return useQuery<CandidatePool>({
    queryKey: [...PAYMENTS_KEY, 'candidates', locale],
    queryFn: async ({ signal }) => {
      const pools = await Promise.all(
        CANDIDATE_STATUSES.map((status) => loadCandidates(status, locale, signal)),
      );
      return {
        items: uniqueBy(
          pools.flatMap((pool) => pool.items),
          (item) => item.registrationId,
        ),
        truncated: pools.some((pool) => pool.truncated),
      };
    },
    enabled,
  });
}

// ---- Deposits ----------------------------------------------------------------------------

export function useAdminDeposits(tab: DepositTab) {
  const { locale } = useI18n();
  const statuses: readonly BankDepositStatus[] = DEPOSIT_TAB_STATUSES[tab];
  return useInfiniteQuery({
    queryKey: [...DEPOSITS_KEY, 'list', tab, locale],
    // One offset per status: the tab's queues are read side by side and merged by time.
    initialPageParam: statuses.map(() => 0),
    queryFn: async ({ pageParam, signal }) => {
      const pages = await Promise.all(
        statuses.map((status, index) => {
          const params = new URLSearchParams({
            status,
            limit: String(PAGE_SIZE),
            offset: String(pageParam[index] ?? 0),
          });
          return apiRequest<Page<BankDepositDto>>(`/v1/admin/bank-deposits?${params}`, {
            locale,
            signal,
          });
        }),
      );
      return mergeDepositPages(pages, pageParam, PAGE_SIZE);
    },
    getNextPageParam: (last) => last.next ?? undefined,
  });
}

const depositPath = (depositId: string, action: 'assign' | 'ignore') =>
  `/v1/admin/bank-deposits/${encodeURIComponent(depositId)}/${action}`;

export const useAssignDeposit = (depositId: string) =>
  useApiMutation<string, BankDepositDto>((registrationId) => ({
    path: depositPath(depositId, 'assign'),
    method: 'POST',
    body: { registrationId },
  }));

export const useIgnoreDeposit = (depositId: string) =>
  useApiMutation<void, BankDepositDto>(() => ({
    path: depositPath(depositId, 'ignore'),
    method: 'POST',
  }));
