import { LOCALES, SUPPORTED_LOCALES, translate } from '@foodboll/i18n';
import { Fragment } from 'react';
import { useI18n } from '../i18n/I18nProvider';

/**
 * First-launch screen. The prompt is shown in every supported language at once ("언어 선택" /
 * "Tilni tanlang") because the user cannot be expected to read a language they have not picked.
 * The detected language is only suggested (focused); nothing is saved until the user chooses.
 */
export function LanguageGate() {
  const { locale: detected, setLanguage } = useI18n();

  return (
    <main className="language-gate">
      <h1 id="gate-title">
        {SUPPORTED_LOCALES.map(({ code }, index) => (
          <Fragment key={code}>
            {index > 0 && ' / '}
            <span lang={LOCALES[code].intlTag}>{translate(code, 'language.select')}</span>
          </Fragment>
        ))}
      </h1>
      <div className="gate-options" role="group" aria-labelledby="gate-title">
        {SUPPORTED_LOCALES.map(({ code, nativeName }) => (
          <button
            key={code}
            type="button"
            lang={LOCALES[code].intlTag}
            className={code === detected ? 'gate-option suggested' : 'gate-option'}
            autoFocus={code === detected}
            onClick={() => void setLanguage(code)}
          >
            {nativeName}
          </button>
        ))}
      </div>
    </main>
  );
}
