import {
  LEGAL_DOCUMENT_TYPES,
  legalDocumentInputSchema,
  type LegalDocumentInput,
  type LegalDocumentType,
} from '@foodboll/contracts';
import { DEFAULT_LOCALE, isLocaleCode, LOCALE_CODES, type LocaleCode } from '@foodboll/i18n';
import type { LegalText, PublishedLegal } from '../api';
import { collectIssues, firstInvalid, type FieldError, type FieldErrors } from '../field-errors';
import { byLocale } from '../locale-record';
import { normalize } from '../text';

export const LEGAL_TEXT_FIELDS = ['title', 'body'] as const;
export type LegalTextField = (typeof LEGAL_TEXT_FIELDS)[number];

export type LegalDraft = Readonly<Record<LocaleCode, LegalText>>;

const EMPTY_TEXT: LegalText = { title: '', body: '' };

/** The route accepts the type in any case; documents are always addressed by the upper-case name. */
export function parseLegalType(value: string): LegalDocumentType | null {
  const upper = value.toUpperCase();
  return LEGAL_DOCUMENT_TYPES.find((type) => type === upper) ?? null;
}

export const legalTextId = (locale: LocaleCode, field: LegalTextField): string =>
  `translations.${locale}.${field}`;

/** Ids in reading order, as the tabs list the languages. */
export const LEGAL_FIELD_IDS: readonly string[] = LOCALE_CODES.flatMap((code) =>
  LEGAL_TEXT_FIELDS.map((field) => legalTextId(code, field)),
);

const KNOWN_IDS: ReadonlySet<string> = new Set(LEGAL_FIELD_IDS);

export function legalFieldLocale(id: string): LocaleCode | null {
  const [head, locale] = id.split('.');
  return head === 'translations' && isLocaleCode(locale) ? locale : null;
}

export const legalDraftFrom = (published: PublishedLegal | null): LegalDraft =>
  byLocale((code) => published?.texts[code] ?? EMPTY_TEXT);

export const hasLegalText = (text: LegalText): boolean =>
  LEGAL_TEXT_FIELDS.some((field) => normalize(text[field]) !== '');

export function withLegalText(
  draft: LegalDraft,
  locale: LocaleCode,
  field: LegalTextField,
  value: string,
): LegalDraft {
  return { ...draft, [locale]: { ...draft[locale], [field]: value } };
}

export const isLegalDirty = (draft: LegalDraft, baseline: LegalDraft): boolean =>
  LOCALE_CODES.some((code) =>
    LEGAL_TEXT_FIELDS.some(
      (field) => normalize(draft[code][field]) !== normalize(baseline[code][field]),
    ),
  );

function valueOf(draft: LegalDraft, id: string): string {
  const [, locale, field] = id.split('.');
  const isField = (value: string | undefined): value is LegalTextField =>
    LEGAL_TEXT_FIELDS.some((name) => name === value);
  return isLocaleCode(locale) && isField(field) ? draft[locale][field] : '';
}

const PARTIAL: FieldError = { key: 'adminSettings.errors.languagePartial' };

export type LegalValidation =
  | { readonly ok: true; readonly input: LegalDocumentInput }
  | { readonly ok: false; readonly errors: FieldErrors; readonly first: string | null };

/**
 * Checks the draft with the shared `legalDocumentInputSchema` that the API applies too. The source
 * language is always sent; other languages only when they have text, and then both fields are required.
 */
export function validateLegalDraft(draft: LegalDraft): LegalValidation {
  const sent = LOCALE_CODES.filter((code) => code === DEFAULT_LOCALE || hasLegalText(draft[code]));
  const result = legalDocumentInputSchema.safeParse({
    translations: Object.fromEntries(sent.map((code) => [code, draft[code]])),
  });
  if (result.success) return { ok: true, input: result.data };

  const errors: Record<string, FieldError> = {
    ...collectIssues(result.error.issues, {
      known: KNOWN_IDS,
      valueOf: (id) => valueOf(draft, id),
    }),
  };
  // A half-written optional language is a different problem from a blank required one.
  for (const code of sent) {
    if (code === DEFAULT_LOCALE) continue;
    for (const field of LEGAL_TEXT_FIELDS) {
      const id = legalTextId(code, field);
      if (id in errors && normalize(draft[code][field]) === '') errors[id] = PARTIAL;
    }
  }
  return { ok: false, errors, first: firstInvalid(errors, LEGAL_FIELD_IDS) };
}

/** What publishing does to one language compared with the version readers have now. */
export type LanguageOutcome = 'written' | 'fallback' | 'removed';

export function outcomeOf(
  code: LocaleCode,
  input: LegalDocumentInput,
  published: PublishedLegal | null,
): LanguageOutcome {
  if (input.translations[code]) return 'written';
  return published?.texts[code] ? 'removed' : 'fallback';
}
