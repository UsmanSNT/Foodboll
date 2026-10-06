import type { MessageKey, MessageParams, Translator } from '@foodboll/i18n';
import { normalize } from './text';

export interface FieldError {
  readonly key: MessageKey;
  readonly params?: MessageParams;
}

/** Errors by field id; ids are the dotted paths of the shared schemas (`translations.ko.title`). */
export type FieldErrors = Readonly<Record<string, FieldError>>;

/** Set when the shared schema rejects something this form has no field for. */
export const FORM_ERROR_ID = 'form';

export const REQUIRED: FieldError = { key: 'form.required' };

/** The slice of a zod issue this module reads. */
export interface IssueLike {
  readonly code: string;
  readonly path: readonly PropertyKey[];
  readonly origin?: string;
  readonly minimum?: number | bigint;
  readonly maximum?: number | bigint;
}

export const fieldIdOf = (path: readonly PropertyKey[]): string => path.map(String).join('.');

/** Wording for a length issue of a text field; `format` is what a failed pattern check says. */
function describeIssue(
  issue: IssueLike,
  value: string,
  format: FieldError | undefined,
): FieldError {
  if (issue.origin === 'string' && issue.code === 'too_small') {
    return normalize(value) === ''
      ? REQUIRED
      : { key: 'adminSettings.errors.tooShort', params: { min: Number(issue.minimum) } };
  }
  if (issue.origin === 'string' && issue.code === 'too_big') {
    return { key: 'form.tooLong', params: { max: Number(issue.maximum) } };
  }
  return format ?? { key: 'errors.VALIDATION_FAILED' };
}

interface IssueTargets {
  /** Field ids this form shows; issues about anything else become a form-level error. */
  readonly known: ReadonlySet<string>;
  readonly valueOf: (id: string) => string;
  /** What a failed pattern check says, by field id. */
  readonly formats?: Readonly<Record<string, FieldError>>;
}

/** Turns the issues of a shared schema into localized field errors. The first issue of a field wins. */
export function collectIssues(
  issues: readonly IssueLike[],
  { known, valueOf, formats = {} }: IssueTargets,
): FieldErrors {
  const errors: Record<string, FieldError> = {};
  for (const issue of issues) {
    const path = fieldIdOf(issue.path);
    const id = known.has(path) ? path : FORM_ERROR_ID;
    if (id in errors) continue;
    errors[id] = describeIssue(issue, id === FORM_ERROR_ID ? '' : valueOf(id), formats[id]);
  }
  return errors;
}

/** The first field in `order` that has an error. */
export const firstInvalid = (errors: FieldErrors, order: readonly string[]): string | null =>
  order.find((id) => id in errors) ?? null;

/** The errors as sentences in the reader's language, by field id. */
export function localizeErrors(
  errors: FieldErrors,
  t: Translator['t'],
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(errors).map(([id, error]) => [id, t(error.key, error.params)]),
  );
}
