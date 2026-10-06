import { LOCALES, type LocaleCode } from '@foodboll/i18n';
import { useI18n } from '../../../i18n/I18nProvider';
import { Badge } from '../../../ui/Badge';

/** The player's language, as context for how to reach them; the full name is read out to assistive tech. */
export function LanguageTag({ language }: { readonly language: LocaleCode | null }) {
  const { t } = useI18n();
  if (language === null) return <Badge>{t('adminPayments.languageNotSet')}</Badge>;
  return (
    <span className="money-lang" role="img" aria-label={t('adminPayments.languageLabel', { language: LOCALES[language].nativeName })}>
      {language.toUpperCase()}
    </span>
  );
}
