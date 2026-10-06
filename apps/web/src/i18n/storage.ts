import { isLocaleCode, type LocaleCode } from '@foodboll/i18n';

const LANGUAGE_KEY = 'foodboll.language';
const DEVICE_LOCALE_SYNCED_KEY = 'foodboll.deviceLocaleSynced';

/** localStorage can throw (private mode, blocked storage); the app must work without it. */
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the choice simply won't survive a restart */
  }
}

/** The language the user explicitly chose on this device. Detected languages are never stored. */
export function readStoredLanguage(): LocaleCode | null {
  const value = read(LANGUAGE_KEY);
  return isLocaleCode(value) ? value : null;
}

export function writeStoredLanguage(locale: LocaleCode): void {
  write(LANGUAGE_KEY, locale);
}

export function readDeviceLocaleSynced(): string | null {
  return read(DEVICE_LOCALE_SYNCED_KEY);
}

export function writeDeviceLocaleSynced(tag: string): void {
  write(DEVICE_LOCALE_SYNCED_KEY, tag);
}

/** Access token issued by the auth module; this app only reads it. */
export function readAccessToken(): string | null {
  return read('foodboll.accessToken');
}

const REGION_KEY = 'foodboll.region';
/** Stored when the user explicitly chose to browse every region. */
export const ALL_REGIONS = 'all';

/** The region the user picked on this device: a region code, `all`, or null if never asked. */
export function readStoredRegion(): string | null {
  const value = read(REGION_KEY);
  return value && /^(all|[a-z]+(-[a-z]+)*)$/.test(value) ? value : null;
}

export function writeStoredRegion(value: string): void {
  write(REGION_KEY, value);
}

export function writeAccessToken(token: string): void {
  write('foodboll.accessToken', token);
}

export function clearAccessToken(): void {
  try {
    window.localStorage.removeItem('foodboll.accessToken');
  } catch {
    /* storage unavailable */
  }
}
