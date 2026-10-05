import { DEFAULT_LOCALE, LOCALE_CODES, type LocaleCode } from './locales';

/** User-authored text keyed by language. Missing or blank entries mean "not translated". */
export type LocalizedText = Readonly<Partial<Record<LocaleCode, string | null | undefined>>>;

export interface LocalizedValue {
  readonly text: string;
  /** Language the text is actually written in. */
  readonly locale: LocaleCode;
  /** True when `locale` differs from the language the reader asked for. */
  readonly isFallback: boolean;
}

function present(content: LocalizedText, locale: LocaleCode): string | null {
  const value = content[locale];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Picks the best text for a reader. Order: the reader's language, the author's source language
 * (the original), the product default, then any other language. Empty and whitespace-only values
 * count as missing, so a cleared translation never produces an empty field.
 */
export function pickLocalized(
  content: LocalizedText,
  requested: LocaleCode,
  sourceLocale?: LocaleCode,
): LocalizedValue | null {
  const chain: readonly LocaleCode[] = [
    requested,
    ...(sourceLocale ? [sourceLocale] : []),
    DEFAULT_LOCALE,
    ...LOCALE_CODES,
  ];
  for (const locale of chain) {
    const text = present(content, locale);
    if (text !== null) return { text, locale, isFallback: locale !== requested };
  }
  return null;
}

/** Languages in `required` that have no usable text; used to flag gaps to admins. */
export function missingLocales(
  content: LocalizedText,
  required: readonly LocaleCode[] = LOCALE_CODES,
): LocaleCode[] {
  return required.filter((locale) => present(content, locale) === null);
}
