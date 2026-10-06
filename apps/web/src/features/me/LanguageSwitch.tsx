import { SUPPORTED_LOCALES, LOCALES } from '@foodboll/i18n';
import { useI18n } from '../../i18n/I18nProvider';
import { Alert } from '../../ui/Alert';
import { Check } from '../../ui/icons';

/** Always lists languages by their own name, so someone on the wrong language can still find theirs. */
export function LanguageSwitch() {
  const { t, locale, setLanguage, accountSaveFailed } = useI18n();
  return (
    <div className="stack">
      <ul className="card list" role="radiogroup" aria-label={t('language.title')}>
        {SUPPORTED_LOCALES.map(({ code, nativeName }) => (
          <li key={code}>
            <button
              type="button"
              role="radio"
              aria-checked={code === locale}
              lang={LOCALES[code].intlTag}
              className="list__item list__item--button"
              onClick={() => void setLanguage(code)}
            >
              <span className="grow">{nativeName}</span>
              {code === locale && <Check size={18} aria-hidden="true" />}
            </button>
          </li>
        ))}
      </ul>
      {accountSaveFailed && <Alert tone="warning">{t('language.saveFailed')}</Alert>}
    </div>
  );
}
