import { LOCALE_CODES, LOCALES, type LocaleCode } from '@foodboll/i18n';

/** One value per supported language, built in the order of the language picker. */
export function byLocale<T>(make: (code: LocaleCode) => T): Record<LocaleCode, T> {
  return Object.fromEntries(LOCALE_CODES.map((code) => [code, make(code)])) as Record<
    LocaleCode,
    T
  >;
}

/** Language names are written in their own language, so a list of them reads the same everywhere. */
export const nativeNames = (codes: readonly LocaleCode[]): string =>
  codes.map((code) => LOCALES[code].nativeName).join(', ');
