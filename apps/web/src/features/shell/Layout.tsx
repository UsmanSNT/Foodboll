import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { useNotifications } from '../../api/queries';
import { useI18n } from '../../i18n/I18nProvider';
import { Calendar, Home, User, Users } from '../../ui/icons';

export function Layout() {
  const { t } = useI18n();
  const { signedIn } = useAuth();
  const notifications = useNotifications();
  const unread = signedIn ? (notifications.data?.unread ?? 0) : 0;

  const tab = (to: string, label: string, Icon: typeof Home, badge = false, end = false) => (
    <NavLink to={to} end={end} className="tab">
      <span className="tab__icon">
        <Icon size={22} aria-hidden="true" />
        {badge && (
          <span className="tab__dot" role="img" aria-label={t('inbox.unread', { count: unread })} />
        )}
      </span>
      <span>{label}</span>
    </NavLink>
  );

  return (
    <div className="app">
      <main className="app__main" id="main">
        <Outlet />
      </main>
      <nav className="tabs" aria-label={t('nav.main')}>
        {tab('/', t('nav.matches'), Home, false, true)}
        {tab('/players', t('nav.players'), Users)}
        {tab('/my-matches', t('nav.myMatches'), Calendar)}
        {tab('/me', t('nav.myPage'), User, unread > 0)}
      </nav>
    </div>
  );
}

/** Screens that sit on top of the tabs (match, payment, profile): no tab bar, back arrow instead. */
export function StackLayout() {
  return (
    <div className="app">
      <main className="app__main app__main--stack" id="main">
        <Outlet />
      </main>
    </div>
  );
}
