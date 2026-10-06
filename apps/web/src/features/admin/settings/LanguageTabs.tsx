import { LOCALE_CODES, LOCALES, type LocaleCode, type MessageKey } from '@foodboll/i18n';
import { useId, type KeyboardEvent, type ReactNode } from 'react';
import { useI18n } from '../../../i18n/I18nProvider';
import { AlertTriangle, CheckCircle2 } from '../../../ui/icons';

export type LanguageStatus = 'empty' | 'filled' | 'problem';

const STATUS_KEY = {
  empty: 'adminSettings.lang.empty',
  filled: 'adminSettings.lang.filled',
  problem: 'adminSettings.lang.problem',
} as const satisfies Record<LanguageStatus, MessageKey>;

function StatusMark({ status }: { readonly status: LanguageStatus }) {
  if (status === 'filled')
    return <CheckCircle2 size={16} className="as-status as-status--ok" aria-hidden="true" />;
  if (status === 'problem')
    return <AlertTriangle size={16} className="as-status as-status--problem" aria-hidden="true" />;
  return <span className="as-status as-status--empty" aria-hidden="true" />;
}

interface LanguageTabsProps {
  readonly active: LocaleCode;
  readonly statuses: Readonly<Record<LocaleCode, LanguageStatus>>;
  readonly onSelect: (locale: LocaleCode) => void;
  /** The fields of the active language. */
  readonly children: ReactNode;
}

/**
 * One tab per language, marked with a dot while it is empty. Arrow keys move between the tabs and
 * select them; only the active language's fields are on the page.
 */
export function LanguageTabs({ active, statuses, onSelect, children }: LanguageTabsProps) {
  const { t } = useI18n();
  const base = useId();
  const tabId = (code: LocaleCode) => `${base}-tab-${code}`;

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = LOCALE_CODES.length - 1;
    const target =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    const code = target === null ? undefined : LOCALE_CODES[target];
    if (code === undefined) return;
    event.preventDefault();
    onSelect(code);
    document.getElementById(tabId(code))?.focus();
  };

  return (
    <div className="stack">
      <div className="segmented as-tabs" role="tablist" aria-label={t('adminSettings.lang.tabs')}>
        {LOCALE_CODES.map((code, index) => (
          <button
            key={code}
            id={tabId(code)}
            type="button"
            role="tab"
            aria-selected={code === active}
            aria-controls={`${base}-panel`}
            tabIndex={code === active ? 0 : -1}
            onClick={() => onSelect(code)}
            onKeyDown={(event) => move(event, index)}
          >
            <span className="as-tab__name" lang={code}>
              {LOCALES[code].nativeName}
            </span>
            <StatusMark status={statuses[code]} />{' '}
            <span className="visually-hidden">{t(STATUS_KEY[statuses[code]])}</span>
          </button>
        ))}
      </div>
      <div id={`${base}-panel`} role="tabpanel" aria-labelledby={tabId(active)} className="stack">
        {children}
      </div>
    </div>
  );
}
