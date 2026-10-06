/**
 * Locale registry — the single place that defines which languages the product supports.
 *
 * Adding a language:
 *   1. Add its code to `LOCALE_CODES` and a descriptor to `LOCALES`.
 *   2. The compiler then forces entries in `GLOSSARY`, the message catalog (`catalog/index.ts`)
 *      and anything else keyed by `LocaleCode`.
 *   3. Add a row to the `languages` table (new SQL migration).
 * See docs/i18n.md.
 */
export const LOCALE_CODES = ['ko', 'uz', 'en'] as const;

export type LocaleCode = (typeof LOCALE_CODES)[number];

/** Language used when nothing else is known, and the content fallback of last resort. */
export const DEFAULT_LOCALE: LocaleCode = 'ko';

export interface LocaleDescriptor {
  readonly code: LocaleCode;
  /** Name of the language written in that language. Never translated. */
  readonly nativeName: string;
  readonly englishName: string;
  /** BCP 47 tag handed to `Intl` APIs and used for `<html lang>`. */
  readonly intlTag: string;
}

export const LOCALES = {
  ko: { code: 'ko', nativeName: '한국어', englishName: 'Korean', intlTag: 'ko-KR' },
  // Uzbek (Latin script). The apostrophe is U+2018 on purpose: an ASCII `'` is an escape
  // character in ICU MessageFormat and must never appear in catalog strings.
  uz: { code: 'uz', nativeName: 'O‘zbekcha', englishName: 'Uzbek', intlTag: 'uz-Latn-UZ' },
  // English is a first-class locale (not a fallback): the catalog is written for foreign residents
  // in Korea. Order in `LOCALE_CODES` is the order shown in the language picker.
  en: { code: 'en', nativeName: 'English', englishName: 'English', intlTag: 'en-US' },
} as const satisfies Record<LocaleCode, LocaleDescriptor>;

export const SUPPORTED_LOCALES: readonly LocaleDescriptor[] = LOCALE_CODES.map(
  (code) => LOCALES[code],
);

export function isLocaleCode(value: unknown): value is LocaleCode {
  return typeof value === 'string' && (LOCALE_CODES as readonly string[]).includes(value);
}
