import { DEFAULT_LOCALE, isLocaleCode, type LocaleCode } from './locales';

/**
 * Maps any BCP 47 / POSIX-style tag (`ko-KR`, `ko_KR`, `uz-Cyrl-UZ`, `UZ`) to a supported locale.
 * Matching is on the primary language subtag only. Uzbek in any script maps to `uz`: the catalog
 * is Latin, which is the official script and readable to Cyrillic users.
 */
export function matchLocale(tag: string): LocaleCode | null {
  const primary = tag.trim().toLowerCase().split(/[-_]/, 1)[0];
  return isLocaleCode(primary) ? primary : null;
}

/** First supported language in a preference-ordered list (e.g. `navigator.languages`). */
export function detectLocale(preferredTags: readonly string[]): LocaleCode | null {
  for (const tag of preferredTags) {
    const match = matchLocale(tag);
    if (match) return match;
  }
  return null;
}

/**
 * Parses an `Accept-Language` header into tags ordered by quality (highest first, stable for ties).
 * Malformed entries and `q=0` entries are dropped. Input is capped to keep parsing O(1) against
 * hostile headers.
 */
export function parseAcceptLanguage(header: string | undefined | null): string[] {
  if (!header) return [];
  const entries: { tag: string; q: number; index: number }[] = [];
  header
    .slice(0, 1024)
    .split(',')
    .slice(0, 32)
    .forEach((part, index) => {
      const [rawTag, ...params] = part.trim().split(';');
      const tag = rawTag?.trim();
      if (!tag || !/^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$|^\*$/.test(tag)) return;
      let q = 1;
      for (const param of params) {
        const [key, value] = param.trim().split('=');
        if (key?.trim().toLowerCase() === 'q') {
          const parsed = Number(value);
          q = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
        }
      }
      if (q > 0) entries.push({ tag, q, index });
    });
  return entries.sort((a, b) => b.q - a.q || a.index - b.index).map((entry) => entry.tag);
}

export type LocaleSource = 'account' | 'stored' | 'device' | 'default';

export interface ResolvedLocale {
  readonly locale: LocaleCode;
  readonly source: LocaleSource;
  /**
   * True when the language was guessed rather than chosen by the user. Clients must show the
   * language selection screen; a guess is never persisted as the user's choice.
   */
  readonly requiresSelection: boolean;
}

export interface ResolveLocaleInput {
  /** `preferred_language` on the user's account, if signed in and set. */
  readonly account?: string | null | undefined;
  /** Explicit choice remembered on this device. */
  readonly stored?: string | null | undefined;
  /** Device language preferences, most preferred first. */
  readonly deviceLanguages?: readonly string[] | undefined;
}

/**
 * Precedence: account choice > choice stored on this device > device language > default.
 * Only the first two are explicit user choices.
 */
export function resolveLocale(input: ResolveLocaleInput): ResolvedLocale {
  if (isLocaleCode(input.account)) {
    return { locale: input.account, source: 'account', requiresSelection: false };
  }
  if (isLocaleCode(input.stored)) {
    return { locale: input.stored, source: 'stored', requiresSelection: false };
  }
  const detected = detectLocale(input.deviceLanguages ?? []);
  if (detected) return { locale: detected, source: 'device', requiresSelection: true };
  return { locale: DEFAULT_LOCALE, source: 'default', requiresSelection: true };
}

export type LanguageSyncAction =
  | { readonly type: 'none' }
  /** Account has no preference yet: save the on-device choice to the account. */
  | { readonly type: 'pushToAccount'; readonly locale: LocaleCode }
  /** Account is the source of truth across devices: overwrite the on-device choice. */
  | { readonly type: 'adoptAccount'; readonly locale: LocaleCode };

/** Decides how to reconcile the account language with the on-device choice after sign-in. */
export function planLanguageSync(input: {
  readonly account: string | null | undefined;
  readonly stored: string | null | undefined;
}): LanguageSyncAction {
  const account = isLocaleCode(input.account) ? input.account : null;
  const stored = isLocaleCode(input.stored) ? input.stored : null;
  if (account) {
    return account === stored ? { type: 'none' } : { type: 'adoptAccount', locale: account };
  }
  return stored ? { type: 'pushToAccount', locale: stored } : { type: 'none' };
}
