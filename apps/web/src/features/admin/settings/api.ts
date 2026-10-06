import type {
  AdminPaymentInstructionDto,
  LegalDocumentDto,
  LegalDocumentInput,
  LegalDocumentType,
  PaymentInstructionInput,
} from '@foodboll/contracts';
import { LOCALE_CODES, type LocaleCode } from '@foodboll/i18n';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiRequest } from '../../../api/client';
import { useApiMutation } from '../../../api/queries';
import { useI18n } from '../../../i18n/I18nProvider';

/** Key bases: one invalidation refreshes everything below them. */
export const ADMIN_PAYMENT_KEY = ['admin-payment-instruction'] as const;
export const ADMIN_LEGAL_KEY = ['admin-legal'] as const;
/** What players read; shared with the public screens. */
const PLAYER_PAYMENT_KEY = ['payment-instruction'] as const;
const PLAYER_LEGAL_KEY = ['legal'] as const;

const isNotFound = (
  error: unknown,
  code: 'PAYMENT_INSTRUCTIONS_NOT_FOUND' | 'LEGAL_DOCUMENT_NOT_FOUND',
): boolean => error instanceof ApiError && error.code === code;

/**
 * Editor data is read once per visit and never swapped under the admin's hands: it is not kept
 * after the screen closes and is not refreshed on focus. A save refreshes it explicitly.
 */
const EDITOR_DATA = { gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false } as const;

// ---- Payment instructions ----------------------------------------------------------------

/** The active bank details with every language's raw text; null while none were ever saved. */
export function useAdminPaymentInstruction() {
  const { locale } = useI18n();
  return useQuery<AdminPaymentInstructionDto | null>({
    queryKey: [...ADMIN_PAYMENT_KEY, locale],
    queryFn: async ({ signal }) => {
      try {
        return await apiRequest<AdminPaymentInstructionDto>(
          '/v1/admin/payment-instructions/current',
          { locale, signal },
        );
      } catch (error) {
        if (isNotFound(error, 'PAYMENT_INSTRUCTIONS_NOT_FOUND')) return null;
        throw error;
      }
    },
    ...EDITOR_DATA,
  });
}

export const useSavePaymentInstruction = () =>
  useApiMutation<PaymentInstructionInput, AdminPaymentInstructionDto>(
    (body) => ({ path: '/v1/admin/payment-instructions', method: 'PUT', body }),
    [ADMIN_PAYMENT_KEY, PLAYER_PAYMENT_KEY],
  );

// ---- Legal documents ---------------------------------------------------------------------

export interface LegalText {
  readonly title: string;
  readonly body: string;
}

/** The published version of a document with the text it has in each language. */
export interface PublishedLegal {
  readonly version: number;
  readonly publishedAt: string;
  readonly texts: Readonly<Partial<Record<LocaleCode, LegalText>>>;
}

const legalPath = (type: LegalDocumentType) => `/v1/legal/${type}`;

/**
 * The API has no endpoint for the raw texts of a document, only the reader's view with a fallback
 * to Korean. So each language is requested once, and a language only counts as written when the
 * answer is in that very language.
 */
async function loadPublishedLegal(
  type: LegalDocumentType,
  signal: AbortSignal,
): Promise<PublishedLegal | null> {
  const views = await Promise.all(
    LOCALE_CODES.map(async (locale) => {
      try {
        return await apiRequest<LegalDocumentDto>(legalPath(type), { locale, signal });
      } catch (error) {
        if (isNotFound(error, 'LEGAL_DOCUMENT_NOT_FOUND')) return null;
        throw error;
      }
    }),
  );
  const any = views.find((view) => view !== null);
  if (!any) return null;

  const texts: Partial<Record<LocaleCode, LegalText>> = {};
  LOCALE_CODES.forEach((locale, index) => {
    const view = views[index];
    if (view && view.title.locale === locale && view.body.locale === locale) {
      texts[locale] = { title: view.title.text, body: view.body.text };
    }
  });
  return { version: any.version, publishedAt: any.publishedAt, texts };
}

/** The current version as a reader in the screen language gets it; null while never published. */
export function useLegalStatus(type: LegalDocumentType) {
  const { locale } = useI18n();
  return useQuery<LegalDocumentDto | null>({
    queryKey: [...ADMIN_LEGAL_KEY, type, 'status', locale],
    queryFn: async ({ signal }) => {
      try {
        return await apiRequest<LegalDocumentDto>(legalPath(type), { locale, signal });
      } catch (error) {
        if (isNotFound(error, 'LEGAL_DOCUMENT_NOT_FOUND')) return null;
        throw error;
      }
    },
  });
}

/** Null when the document was never published. The result does not depend on the screen language. */
export function usePublishedLegal(type: LegalDocumentType) {
  return useQuery<PublishedLegal | null>({
    queryKey: [...ADMIN_LEGAL_KEY, type],
    queryFn: ({ signal }) => loadPublishedLegal(type, signal),
    ...EDITOR_DATA,
  });
}

export const usePublishLegalDocument = (type: LegalDocumentType) =>
  useApiMutation<LegalDocumentInput, LegalDocumentDto>(
    (body) => ({ path: `/v1/admin/legal/${type}`, method: 'PUT', body }),
    [PLAYER_LEGAL_KEY, ADMIN_LEGAL_KEY],
  );
