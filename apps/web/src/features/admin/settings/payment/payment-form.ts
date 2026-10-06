import {
  paymentInstructionInputSchema,
  type AdminPaymentInstructionDto,
  type PaymentInstructionDto,
  type PaymentInstructionInput,
} from '@foodboll/contracts';
import {
  DEFAULT_LOCALE,
  isLocaleCode,
  LOCALE_CODES,
  pickLocalized,
  type LocaleCode,
} from '@foodboll/i18n';
import { collectIssues, firstInvalid, type FieldError, type FieldErrors } from '../field-errors';
import { byLocale } from '../locale-record';
import { normalize } from '../text';

export const PAYMENT_TEXT_FIELDS = ['bankName', 'instructions'] as const;
export type PaymentTextField = (typeof PAYMENT_TEXT_FIELDS)[number];

export type PaymentText = Readonly<Record<PaymentTextField, string>>;

export interface PaymentDraft {
  readonly accountNumber: string;
  readonly accountHolder: string;
  readonly texts: Readonly<Record<LocaleCode, PaymentText>>;
}

const EMPTY_TEXT: PaymentText = { bankName: '', instructions: '' };

export const paymentTextId = (locale: LocaleCode, field: PaymentTextField): string =>
  `translations.${locale}.${field}`;

/** Ids in reading order: the bank account first, then the languages as the tabs list them. */
export const PAYMENT_FIELD_IDS: readonly string[] = [
  'accountNumber',
  'accountHolder',
  ...LOCALE_CODES.flatMap((code) => PAYMENT_TEXT_FIELDS.map((field) => paymentTextId(code, field))),
];

const KNOWN_IDS: ReadonlySet<string> = new Set(PAYMENT_FIELD_IDS);

/** The language a field id belongs to, or null for the bank account fields. */
export function paymentFieldLocale(id: string): LocaleCode | null {
  const [head, locale] = id.split('.');
  return head === 'translations' && isLocaleCode(locale) ? locale : null;
}

export function paymentDraftFrom(current: AdminPaymentInstructionDto | null): PaymentDraft {
  return {
    accountNumber: current?.accountNumber ?? '',
    accountHolder: current?.accountHolder ?? '',
    texts: byLocale((code) => current?.translations[code] ?? EMPTY_TEXT),
  };
}

/** A language counts as written as soon as any of its fields has text. */
export const hasPaymentText = (text: PaymentText): boolean =>
  PAYMENT_TEXT_FIELDS.some((field) => normalize(text[field]) !== '');

export function withPaymentText(
  draft: PaymentDraft,
  locale: LocaleCode,
  field: PaymentTextField,
  value: string,
): PaymentDraft {
  return {
    ...draft,
    texts: { ...draft.texts, [locale]: { ...draft.texts[locale], [field]: value } },
  };
}

export function isPaymentDirty(draft: PaymentDraft, baseline: PaymentDraft): boolean {
  return (
    normalize(draft.accountNumber) !== normalize(baseline.accountNumber) ||
    normalize(draft.accountHolder) !== normalize(baseline.accountHolder) ||
    LOCALE_CODES.some((code) =>
      PAYMENT_TEXT_FIELDS.some(
        (field) => normalize(draft.texts[code][field]) !== normalize(baseline.texts[code][field]),
      ),
    )
  );
}

/** Languages other than the source that have no text in the draft; their readers see Korean. */
export const emptyPaymentLanguages = (draft: PaymentDraft): LocaleCode[] =>
  LOCALE_CODES.filter((code) => code !== DEFAULT_LOCALE && !hasPaymentText(draft.texts[code]));

function valueOf(draft: PaymentDraft, id: string): string {
  if (id === 'accountNumber') return draft.accountNumber;
  if (id === 'accountHolder') return draft.accountHolder;
  const [, locale, field] = id.split('.');
  const isField = (value: string | undefined): value is PaymentTextField =>
    PAYMENT_TEXT_FIELDS.some((name) => name === value);
  return isLocaleCode(locale) && isField(field) ? draft.texts[locale][field] : '';
}

const PARTIAL: FieldError = { key: 'adminSettings.errors.languagePartial' };
const FORMATS: Readonly<Record<string, FieldError>> = {
  accountNumber: { key: 'adminSettings.payment.errors.accountNumberFormat' },
};

export type PaymentValidation =
  | { readonly ok: true; readonly input: PaymentInstructionInput }
  | { readonly ok: false; readonly errors: FieldErrors; readonly first: string | null };

/**
 * Checks the draft with the shared `paymentInstructionInputSchema` that the API applies too. The
 * source language is always sent (so its blanks are reported); other languages only when they have
 * text, and then both of their fields are required.
 */
export function validatePaymentDraft(draft: PaymentDraft): PaymentValidation {
  const sent = LOCALE_CODES.filter(
    (code) => code === DEFAULT_LOCALE || hasPaymentText(draft.texts[code]),
  );
  const result = paymentInstructionInputSchema.safeParse({
    accountNumber: draft.accountNumber,
    accountHolder: draft.accountHolder,
    translations: Object.fromEntries(sent.map((code) => [code, draft.texts[code]])),
  });
  if (result.success) return { ok: true, input: result.data };

  const reported = collectIssues(result.error.issues, {
    known: KNOWN_IDS,
    valueOf: (id) => valueOf(draft, id),
    formats: FORMATS,
  });
  const errors: Record<string, FieldError> = { ...reported };
  // A half-written optional language is a different problem from a blank required one.
  for (const code of sent) {
    if (code === DEFAULT_LOCALE) continue;
    for (const field of PAYMENT_TEXT_FIELDS) {
      const id = paymentTextId(code, field);
      if (id in errors && normalize(draft.texts[code][field]) === '') errors[id] = PARTIAL;
    }
  }
  return { ok: false, errors, first: firstInvalid(errors, PAYMENT_FIELD_IDS) };
}

/** What a payment-instruction record needs for players: the shape both the API and the draft have. */
export interface PaymentSource {
  readonly accountNumber: string;
  readonly accountHolder: string;
  readonly translations: Readonly<Partial<Record<LocaleCode, PaymentText>>>;
}

export type PlayerPaymentView = Pick<
  PaymentInstructionDto,
  'bankName' | 'accountNumber' | 'accountHolder' | 'instructions'
>;

/** The card a player reading `locale` gets, with the same fallback to Korean the API applies. */
export function playerView(source: PaymentSource, locale: LocaleCode): PlayerPaymentView | null {
  const pick = (field: PaymentTextField) =>
    pickLocalized(
      byLocale((code) => source.translations[code]?.[field]),
      locale,
      DEFAULT_LOCALE,
    );
  const bankName = pick('bankName');
  const instructions = pick('instructions');
  if (!bankName || !instructions) return null;
  return {
    bankName,
    accountNumber: source.accountNumber,
    accountHolder: source.accountHolder,
    instructions,
  };
}
