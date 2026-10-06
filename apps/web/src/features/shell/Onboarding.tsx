import { LOCALES, SUPPORTED_LOCALES, translate } from '@foodboll/i18n';
import { Fragment } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { RegionPicker } from '../../region/RegionPicker';
import { useRegion } from '../../region/RegionProvider';
import { Button } from '../../ui/Button';
import { LogoMark } from '../../ui/Logo';

/**
 * First-launch screen. The prompt is shown in every supported language at once ("언어 선택" /
 * "Tilni tanlang" / "Select language") because the user cannot be expected to read a language
 * they have not picked. The detected language is only suggested; nothing is saved until they choose.
 */
export function LanguageGate() {
  const { locale: detected, setLanguage } = useI18n();
  return (
    <main className="gate">
      <div className="gate__hero">
        <LogoMark size={72} />
        <h1 id="gate-title">
          {SUPPORTED_LOCALES.map(({ code }, index) => (
            <Fragment key={code}>
              {index > 0 && ' / '}
              <span lang={LOCALES[code].intlTag}>{translate(code, 'language.select')}</span>
            </Fragment>
          ))}
        </h1>
      </div>
      <div className="gate__options" role="group" aria-labelledby="gate-title">
        {SUPPORTED_LOCALES.map(({ code, nativeName }) => (
          <button
            key={code}
            type="button"
            lang={LOCALES[code].intlTag}
            className={code === detected ? 'gate__option gate__option--suggested' : 'gate__option'}
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

/** Second launch step: where do you play? Skippable ("browse all regions"). */
export function RegionOnboarding() {
  const { t } = useI18n();
  const { choose } = useRegion();
  return (
    <main className="gate gate--region">
      <div className="stack">
        <LogoMark size={56} />
        <h1>{t('region.pickPrompt')}</h1>
        <p className="muted">{t('region.pickHint')}</p>
      </div>
      <div className="gate__panel">
        <RegionPicker current={null} allowAll={false} onSelect={(code) => void choose(code, { asHome: true })} />
      </div>
      <Button variant="ghost" block onClick={() => void choose(null)}>
        {t('region.skip')}
      </Button>
    </main>
  );
}
