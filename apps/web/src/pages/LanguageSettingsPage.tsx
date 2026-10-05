import { Breadcrumb } from '../components/Breadcrumb';
import { LanguagePicker } from '../components/LanguagePicker';
import { useI18n } from '../i18n/I18nProvider';

export function LanguageSettingsPage() {
  const { t, locale, setLanguage, accountSaveFailed } = useI18n();
  return (
    <section>
      <Breadcrumb
        trail={[
          { to: '/me', label: t('myPage.title') },
          { to: '/me/settings', label: t('myPage.settings') },
          { label: t('language.title') },
        ]}
      />
      <h1>{t('language.title')}</h1>
      <p>{t('language.description')}</p>
      <LanguagePicker
        legend={t('language.current')}
        selected={locale}
        onSelect={(next) => void setLanguage(next)}
      />
      <p role="status">{accountSaveFailed && t('language.saveFailed')}</p>
    </section>
  );
}
