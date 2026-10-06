import { matchInputSchema, type MatchInput } from '@foodboll/contracts';
import {
  isLocaleCode,
  LOCALE_CODES,
  type LocaleCode,
  type MessageKey,
  type MessageParams,
} from '@foodboll/i18n';
import { koreanDateKey } from '../../../lib/dates';
import {
  LIMITS,
  hasText,
  TRANSLATION_FIELDS,
  type FormState,
  type TranslationField,
} from './form-state';
import { isDateKey, isTimeOfDay, MAX_MATCH_HOURS, resolveWindow, windowProblems } from './kst';

export interface FieldError {
  readonly key: MessageKey;
  readonly params?: MessageParams;
}

/** Errors by field id; ids are the ones `translationFieldId` and the plain field names produce. */
export type FieldErrors = Readonly<Record<string, FieldError>>;

export type ValidationResult =
  | { readonly ok: true; readonly input: MatchInput }
  | { readonly ok: false; readonly errors: FieldErrors };

export const translationFieldId = (locale: LocaleCode, field: TranslationField): string =>
  `translations.${locale}.${field}`;

/** The language a translation field id belongs to, or null for any other field. */
export function localeOfField(id: string): LocaleCode | null {
  const [head, locale] = id.split('.');
  return head === 'translations' && isLocaleCode(locale) ? locale : null;
}

/** Set when the shared schema rejects something this form has no field for. */
export const FORM_ERROR_ID = 'form';

const REQUIRED: FieldError = { key: 'form.required' };
const GENERIC: FieldError = { key: 'errors.VALIDATION_FAILED' };

/** In the order the fields appear on screen. */
const PLAIN_FIELDS = [
  'regionCode',
  'venueName',
  'venueAddress',
  'date',
  'startTime',
  'endTime',
  'playersPerSide',
  'maxPlayers',
];

/** The first field in reading order that has an error, with the original language read first. */
export function firstInvalidField(errors: FieldErrors, sourceLanguage: LocaleCode): string | null {
  const languages = [sourceLanguage, ...LOCALE_CODES.filter((code) => code !== sourceLanguage)];
  const order = [
    ...PLAIN_FIELDS,
    ...languages.flatMap((code) =>
      TRANSLATION_FIELDS.map((field) => translationFieldId(code, field)),
    ),
  ];
  return order.find((id) => id in errors) ?? null;
}

interface IssueLike {
  readonly code: string;
  readonly path: readonly PropertyKey[];
  readonly origin?: string;
  readonly maximum?: number | bigint;
}

function describeIssue(issue: IssueLike, state: FormState): FieldError {
  if (issue.origin === 'string' && issue.code === 'too_small') return REQUIRED;
  if (issue.origin === 'string' && issue.code === 'too_big') {
    return { key: 'form.tooLong', params: { max: Number(issue.maximum) } };
  }
  if (issue.path[0] === 'playersPerSide') {
    return { key: 'matchForm.errors.playersPerSide', params: { ...LIMITS.playersPerSide } };
  }
  if (issue.path[0] === 'maxPlayers') {
    return {
      key: 'matchForm.errors.maxPlayers',
      params: { min: state.playersPerSide * 2, max: LIMITS.maxPlayers },
    };
  }
  return GENERIC;
}

/** Which form field an issue of the shared schema belongs to (null: already reported or not shown). */
function issueTarget(path: readonly PropertyKey[], hasWindow: boolean): string | null {
  const [head, locale, field] = path;
  switch (head) {
    case 'startsAt':
      return hasWindow ? 'date' : null;
    case 'endsAt':
      return hasWindow ? 'endTime' : null;
    case 'translations':
      return typeof locale === 'string' && typeof field === 'string'
        ? `translations.${locale}.${field}`
        : null;
    default:
      return typeof head === 'string' && PLAIN_FIELDS.includes(head) ? head : null;
  }
}

/**
 * Checks the whole form: what only this screen knows (Korean-time window, the language rules)
 * first, then the shared `matchInputSchema` that the API also applies. On success `input` is the
 * schema's output, ready to send: texts trimmed and normalized, blank optional fields as null,
 * languages without any text left out.
 */
export function validateMatchForm(state: FormState, now: Date): ValidationResult {
  const errors: Record<string, FieldError> = {};

  if (state.regionCode === null) errors.regionCode = REQUIRED;

  if (!isDateKey(state.date)) errors.date = REQUIRED;
  if (!isTimeOfDay(state.startTime)) errors.startTime = REQUIRED;
  if (!isTimeOfDay(state.endTime)) errors.endTime = REQUIRED;
  const window = resolveWindow(state.date, state.startTime, state.endTime);
  for (const problem of window ? windowProblems(window, now) : []) {
    if (problem === 'startInPast') {
      errors[state.date < koreanDateKey(now) ? 'date' : 'startTime'] = {
        key: 'matchForm.errors.startPast',
      };
    } else {
      errors.endTime = { key: 'matchForm.errors.tooLong', params: { hours: MAX_MATCH_HOURS } };
    }
  }

  for (const code of LOCALE_CODES) {
    const isSource = code === state.sourceLanguage;
    const draft = state.translations[code];
    if (draft.title.trim() === '' && (isSource || hasText(draft))) {
      errors[translationFieldId(code, 'title')] = {
        key: isSource ? 'matchForm.errors.sourceTitle' : 'matchForm.errors.languageTitle',
      };
    }
  }

  const parsed = matchInputSchema.safeParse({
    sourceLanguage: state.sourceLanguage,
    regionCode: state.regionCode ?? '',
    startsAt: window?.startsAt ?? '',
    endsAt: window?.endsAt ?? '',
    venueName: state.venueName,
    venueAddress: state.venueAddress,
    playersPerSide: state.playersPerSide,
    maxPlayers: state.maxPlayers,
    translations: Object.fromEntries(
      LOCALE_CODES.flatMap((code) =>
        hasText(state.translations[code]) ? [[code, state.translations[code]] as const] : [],
      ),
    ),
  });

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const target = issueTarget(issue.path, window !== null);
      if (target !== null && !(target in errors)) errors[target] = describeIssue(issue, state);
    }
    // The schema rejected something no field explains: never let the submit do nothing silently.
    if (Object.keys(errors).length === 0) errors[FORM_ERROR_ID] = GENERIC;
  }

  return parsed.success && Object.keys(errors).length === 0
    ? { ok: true, input: parsed.data }
    : { ok: false, errors };
}
