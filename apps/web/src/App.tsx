import { useEffect } from 'react';
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
import { NotFoundPage } from './features/shell/NotFoundPage';
import { LanguageGate, RegionOnboarding } from './features/shell/Onboarding';
import { useI18n } from './i18n/I18nProvider';
import { useRegion } from './region/RegionProvider';

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
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  );
}
