import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { FeedPage } from './features/feed/FeedPage';
import { LegalIndexPage, LegalPage } from './features/me/LegalPage';
import { MePage } from './features/me/MePage';
import { SettingsPage } from './features/me/SettingsPage';
import { MatchDetailPage } from './features/match/MatchDetailPage';
import { NotificationsPage } from './features/notifications/NotificationsPage';
import { PlayerProfilePage } from './features/players/PlayerProfilePage';
import { PlayersPage } from './features/players/PlayersPage';
import { MyMatchesPage } from './features/registrations/MyMatchesPage';
import { RegistrationPage } from './features/registrations/RegistrationPage';
import { Layout, StackLayout } from './features/shell/Layout';
import { RequireRole } from './features/shell/RequireRole';
import { ListSkeleton } from './ui/Skeleton';
import { NotFoundPage } from './features/shell/NotFoundPage';
import { LanguageGate, RegionOnboarding } from './features/shell/Onboarding';
import { useI18n } from './i18n/I18nProvider';
import { useRegion } from './region/RegionProvider';

// Staff screens are rarely opened by players, so they are loaded on demand.
const lazyPage = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((module) => ({ default: module[name] })));

const OrganizerHomePage = lazyPage(() => import('./features/organizer/OrganizerHomePage'), 'OrganizerHomePage');
const RosterPage = lazyPage(() => import('./features/organizer/RosterPage'), 'RosterPage');
const OrganizerApplyPage = lazyPage(() => import('./features/organizer/OrganizerApplyPage'), 'OrganizerApplyPage');
const MatchFormPage = lazyPage(() => import('./features/organizer/MatchFormPage'), 'MatchFormPage');
const AdminHomePage = lazyPage(() => import('./features/admin/AdminHomePage'), 'AdminHomePage');
const AdminPaymentsPage = lazyPage(() => import('./features/admin/AdminPaymentsPage'), 'AdminPaymentsPage');
const AdminDepositsPage = lazyPage(() => import('./features/admin/AdminDepositsPage'), 'AdminDepositsPage');
const AdminApplicationsPage = lazyPage(() => import('./features/admin/AdminApplicationsPage'), 'AdminApplicationsPage');
const AdminUsersPage = lazyPage(() => import('./features/admin/AdminUsersPage'), 'AdminUsersPage');
const AdminPaymentInfoPage = lazyPage(() => import('./features/admin/AdminPaymentInfoPage'), 'AdminPaymentInfoPage');
const AdminLegalPage = lazyPage(() => import('./features/admin/AdminLegalPage'), 'AdminLegalPage');

const STAFF = ['ORGANIZER', 'ADMIN'] as const;
const ADMIN = ['ADMIN'] as const;

function Guarded({ roles, children }: { readonly roles?: readonly ('PLAYER' | 'ORGANIZER' | 'ADMIN')[]; readonly children: ReactNode }) {
  return (
    <RequireRole {...(roles && { roles })}>
      <Suspense fallback={<div className="page"><ListSkeleton rows={2} /></div>}>{children}</Suspense>
    </RequireRole>
  );
}

/** New screens start at the top, like page loads, instead of keeping the previous scroll offset. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);
  return null;
}

export function App() {
  const { requiresSelection } = useI18n();
  const { needsOnboarding } = useRegion();
  const { pathname } = useLocation();

  if (requiresSelection) return <LanguageGate />;
  // Only the home screen asks where you play; a shared link to one match opens straight away.
  if (needsOnboarding && pathname === '/') return <RegionOnboarding />;

  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<FeedPage />} />
          <Route path="players" element={<PlayersPage />} />
          <Route path="my-matches" element={<MyMatchesPage />} />
          <Route path="me" element={<MePage />} />
        </Route>
        <Route element={<StackLayout />}>
          <Route path="matches/:id" element={<MatchDetailPage />} />
          <Route path="registrations/:id" element={<RegistrationPage />} />
          <Route path="players/:id" element={<PlayerProfilePage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="legal" element={<LegalIndexPage />} />
          <Route path="legal/:type" element={<LegalPage />} />
          <Route path="organizer" element={<Guarded roles={STAFF}><OrganizerHomePage /></Guarded>} />
          <Route path="organizer/apply" element={<Guarded><OrganizerApplyPage /></Guarded>} />
          <Route path="organizer/matches/new" element={<Guarded roles={STAFF}><MatchFormPage /></Guarded>} />
          <Route path="organizer/matches/:id/edit" element={<Guarded roles={STAFF}><MatchFormPage /></Guarded>} />
          <Route path="organizer/matches/:id/roster" element={<Guarded roles={STAFF}><RosterPage /></Guarded>} />
          <Route path="admin" element={<Guarded roles={ADMIN}><AdminHomePage /></Guarded>} />
          <Route path="admin/payments" element={<Guarded roles={ADMIN}><AdminPaymentsPage /></Guarded>} />
          <Route path="admin/deposits" element={<Guarded roles={ADMIN}><AdminDepositsPage /></Guarded>} />
          <Route path="admin/applications" element={<Guarded roles={ADMIN}><AdminApplicationsPage /></Guarded>} />
          <Route path="admin/users" element={<Guarded roles={ADMIN}><AdminUsersPage /></Guarded>} />
          <Route path="admin/payment-info" element={<Guarded roles={ADMIN}><AdminPaymentInfoPage /></Guarded>} />
          <Route path="admin/legal" element={<Guarded roles={ADMIN}><AdminLegalPage /></Guarded>} />
          <Route path="admin/legal/:type" element={<Guarded roles={ADMIN}><AdminLegalPage /></Guarded>} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  );
}
