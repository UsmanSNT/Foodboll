import { LOCALES } from '@foodboll/i18n';
import { Link } from 'react-router-dom';
import { Breadcrumb } from '../components/Breadcrumb';
import { useI18n } from '../i18n/I18nProvider';

export function SettingsPage() {
  const { t, locale } = useI18n();
  return (
    <section>
      <Breadcrumb
        trail={[{ to: '/me', label: t('myPage.title') }, { label: t('myPage.settings') }]}
      />
      <h1>{t('settings.title')}</h1>
      <ul className="menu">
        <li>
          <Link to="/me/settings/language">
            {t('language.title')}
            <span className="menu-value" lang={LOCALES[locale].intlTag}>
              {LOCALES[locale].nativeName}
            </span>
          </Link>
        </li>
      </ul>
    </section>
  );
}
