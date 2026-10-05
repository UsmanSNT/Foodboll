import { IntlMessageFormat } from 'intl-messageformat';
import { CATALOGS, type Catalog, type MessageKey } from './catalog';
import { DEFAULT_LOCALE, LOCALE_CODES, LOCALES, type LocaleCode } from './locales';

export type MessageParams = Readonly<Record<string, string | number | Date>>;

export interface Translator {
  readonly locale: LocaleCode;
  t(key: MessageKey, params?: MessageParams): string;
}

export interface TranslatorOptions {
  /** Called when a message fails to format (e.g. a missing parameter). Never thrown. */
  readonly onError?: (error: unknown, key: string, locale: LocaleCode) => void;
}

type Flat = ReadonlyMap<string, string>;

function flatten(node: Catalog | Record<string, unknown>, prefix = '', out = new Map<string, string>()) {
  for (const [name, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${name}` : name;
    if (typeof value === 'string') out.set(path, value);
    else flatten(value as Record<string, unknown>, path, out);
  }
  return out;
}

const FLAT: Readonly<Record<LocaleCode, Flat>> = Object.fromEntries(
  LOCALE_CODES.map((code) => [code, flatten(CATALOGS[code])]),
) as unknown as Record<LocaleCode, Flat>;

const formatters = new Map<string, IntlMessageFormat>();

function formatter(locale: LocaleCode, key: string, message: string): IntlMessageFormat {
  const cacheKey = `${locale}\u0000${key}`;
  let compiled = formatters.get(cacheKey);
  if (!compiled) {
    compiled = new IntlMessageFormat(message, LOCALES[locale].intlTag);
    formatters.set(cacheKey, compiled);
  }
  return compiled;
}

/** Type guard for keys that arrive as data (e.g. API error codes mapped to `errors.<code>`). */
export function hasMessage(key: string): key is MessageKey {
  return FLAT[DEFAULT_LOCALE].has(key);
}

/** Raw (unformatted) message text; exposed for tooling and tests. */
export function rawMessage(locale: LocaleCode, key: MessageKey): string {
  return FLAT[locale].get(key) ?? FLAT[DEFAULT_LOCALE].get(key) ?? key;
}

export function translate(
  locale: LocaleCode,
  key: MessageKey,
  params?: MessageParams,
  options?: TranslatorOptions,
): string {
  const message = FLAT[locale].get(key) ?? FLAT[DEFAULT_LOCALE].get(key);
  if (message === undefined) return key;
  try {
    const result = formatter(locale, key, message).format<string>(params as never);
    return typeof result === 'string' ? result : String(result);
  } catch (error) {
    options?.onError?.(error, key, locale);
    return message;
  }
}

export function createTranslator(locale: LocaleCode, options?: TranslatorOptions): Translator {
  return { locale, t: (key, params) => translate(locale, key, params, options) };
}
