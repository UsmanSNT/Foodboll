import { NavLink, Outlet } from 'react-router-dom';
import { useI18n } from '../i18n/I18nProvider';

export function Layout() {
  const { t } = useI18n();
  return (
    <div className="app">
      <main className="content">
        <Outlet />
      </main>
      <nav className="tabs" aria-label={t('nav.main')}>
        <NavLink to="/" end>
          {t('nav.matches')}
        </NavLink>
        <NavLink to="/me">{t('nav.myPage')}</NavLink>
      </nav>
    </div>
  );
}
