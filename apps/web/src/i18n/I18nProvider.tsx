import type { MeDto } from '@foodboll/contracts';
import {
  createTranslator,
  formatDate,
  formatDateLong,
  formatDateTime,
  formatKrw,
  LOCALES,
  planLanguageSync,
  resolveLocale,
  type LocaleCode,
  type Translator,
} from '@foodboll/i18n';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { apiRequest } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import {
  readDeviceLocaleSynced,
  readStoredLanguage,
  writeDeviceLocaleSynced,
  writeStoredLanguage,
} from './storage';

export interface I18nValue {
  readonly locale: LocaleCode;
  readonly t: Translator['t'];
  /** Explicitly choose a language: applies immediately, remembers it, and saves it to the account. */
  setLanguage(locale: LocaleCode): Promise<void>;
  /** True while the user has never chosen a language and must be shown the selection screen. */
  readonly requiresSelection: boolean;
  /** True when the last attempt to save the choice to the account failed. */
  readonly accountSaveFailed: boolean;
  formatDateTime(value: string | Date): string;
  /** `Fri, Dec 11`-style date in Korean time. */
  formatDate(value: string | Date): string;
  /** `Dec 11, 2026`-style date in Korean time. */
  formatDateLong(value: string | Date): string;
  formatKrw(amount: number): string;
}

const I18nContext = createContext<I18nValue | null>(null);

function deviceLanguages(): readonly string[] {
  return typeof navigator === 'undefined'
    ? []
    : navigator.languages?.length
      ? navigator.languages
      : [navigator.language];
}

export function I18nProvider({ children }: { readonly children: ReactNode }) {
  const { token } = useAuth();
  const [stored, setStored] = useState<LocaleCode | null>(readStoredLanguage);
  const [account, setAccount] = useState<LocaleCode | null>(null);
  // A signed-in user with no local choice must wait for the account language, or they would
  // briefly be shown the selection screen they already completed on another device.
  const [accountPending, setAccountPending] = useState(() => token !== null && stored === null);
  const [accountSaveFailed, setAccountSaveFailed] = useState(false);

  const resolved = useMemo(
    () => resolveLocale({ account, stored, deviceLanguages: deviceLanguages() }),
    [account, stored],
  );
  const locale = resolved.locale;

  useEffect(() => {
    document.documentElement.lang = LOCALES[locale].intlTag;
  }, [locale]);

  // On sign-in/startup: reconcile the account language with this device (account wins).
  useEffect(() => {
    if (token === null) return;
    const controller = new AbortController();
    // Never leave the app blank because the API is slow or unreachable.
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]);
    void (async () => {
      try {
        const me = await apiRequest<MeDto>('/v1/me', { signal });
        const action = planLanguageSync({
          account: me.preferredLanguage,
          stored: readStoredLanguage(),
        });
        if (action.type === 'adoptAccount') {
          writeStoredLanguage(action.locale);
          setStored(action.locale);
        }
        setAccount(me.preferredLanguage);
        const deviceTag = deviceLanguages()[0];
        const body = {
          ...(action.type === 'pushToAccount' && { preferredLanguage: action.locale }),
          ...(deviceTag && readDeviceLocaleSynced() !== deviceTag && { deviceLocale: deviceTag }),
        };
        if (Object.keys(body).length > 0) {
          await apiRequest<MeDto>('/v1/me/language', { method: 'PATCH', body, signal });
          if (body.deviceLocale) writeDeviceLocaleSynced(body.deviceLocale);
          if (body.preferredLanguage) setAccount(body.preferredLanguage);
        }
      } catch {
        /* offline or signed out: the on-device choice keeps working */
      } finally {
        if (!controller.signal.aborted) setAccountPending(false);
      }
    })();
    return () => controller.abort();
  }, [token]);

  const setLanguage = useCallback(
    async (next: LocaleCode) => {
      writeStoredLanguage(next);
      setStored(next);
      setAccount((current) => (current === null ? current : next));
      setAccountSaveFailed(false);
      if (token === null) return;
      try {
        await apiRequest<MeDto>('/v1/me/language', {
          method: 'PATCH',
          body: { preferredLanguage: next },
        });
        setAccount(next);
      } catch {
        setAccountSaveFailed(true);
      }
    },
    [token],
  );

  const value = useMemo<I18nValue>(() => {
    const translator = createTranslator(locale);
    return {
      locale,
      t: translator.t,
      setLanguage,
      requiresSelection: !accountPending && resolved.requiresSelection,
      accountSaveFailed,
      formatDateTime: (v) => formatDateTime(locale, v),
      formatDate: (v) => formatDate(locale, v),
      formatDateLong: (v) => formatDateLong(locale, v),
      formatKrw: (amount) => formatKrw(locale, amount),
    };
  }, [locale, setLanguage, accountPending, resolved.requiresSelection, accountSaveFailed]);

  if (accountPending) return null;
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}
