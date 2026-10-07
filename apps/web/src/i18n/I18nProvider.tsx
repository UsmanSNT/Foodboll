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
  type LanguageSyncAction,
  type LocaleCode,
  type Translator,
} from '@foodboll/i18n';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { apiRequest } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import {
  readDeviceLocaleSynced,
  readLanguageUnsaved,
  readStoredLanguage,
  writeDeviceLocaleSynced,
  writeLanguageUnsaved,
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
    let cancelled = false;
    // Never leave the app blank because the API is slow or unreachable. (AbortSignal.any and
    // AbortSignal.timeout are missing in older mobile browsers, so use one controller and a timer.)
    const timer = setTimeout(() => controller.abort(), 5_000);
    const { signal } = controller;
    void (async () => {
      try {
        const me = await apiRequest<MeDto>('/v1/me', { signal });
        const stored = readStoredLanguage();
        // A choice that never reached the account must win over the stale account value.
        const planned = planLanguageSync({ account: me.preferredLanguage, stored });
        const action: LanguageSyncAction =
          planned.type === 'adoptAccount' && stored !== null && readLanguageUnsaved()
            ? { type: 'pushToAccount', locale: stored }
            : planned;
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
          if (body.preferredLanguage) {
            writeLanguageUnsaved(false);
            setAccount(body.preferredLanguage);
          }
        }
      } catch {
        /* offline, timed out or signed out: the on-device choice keeps working */
      } finally {
        clearTimeout(timer);
        if (!cancelled) setAccountPending(false);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [token]);

  // Saves run one after another and only the latest choice is sent, so a quick ko -> uz -> en
  // can never end with an older response overwriting the newer language on the account.
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const latestChoice = useRef<LocaleCode | null>(null);

  const setLanguage = useCallback(
    (next: LocaleCode): Promise<void> => {
      writeStoredLanguage(next);
      setStored(next);
      setAccount((current) => (current === null ? current : next));
      setAccountSaveFailed(false);
      if (token === null) return Promise.resolve();
      latestChoice.current = next;
      writeLanguageUnsaved(true);
      const save = async () => {
        if (latestChoice.current !== next) return; // superseded by a newer choice
        try {
          await apiRequest<MeDto>('/v1/me/language', {
            method: 'PATCH',
            body: { preferredLanguage: next },
          });
          if (latestChoice.current !== next) return;
          writeLanguageUnsaved(false);
          setAccount(next);
        } catch {
          if (latestChoice.current === next) setAccountSaveFailed(true);
        }
      };
      const run = saveQueue.current.then(save);
      saveQueue.current = run;
      return run;
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
