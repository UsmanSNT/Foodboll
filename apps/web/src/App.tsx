import { Route, Routes } from 'react-router-dom';
import { LanguageGate } from './components/LanguageGate';
import { Layout } from './components/Layout';
import { useI18n } from './i18n/I18nProvider';
import { LanguageSettingsPage } from './pages/LanguageSettingsPage';
import { LegalPage } from './pages/LegalPage';
import { MatchDetailPage } from './pages/MatchDetailPage';
import { MatchesPage } from './pages/MatchesPage';
import { MyPage } from './pages/MyPage';
import { MyRegistrationsPage } from './pages/MyRegistrationsPage';
import { PaymentInfoPage } from './pages/PaymentInfoPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  const { requiresSelection } = useI18n();
  if (requiresSelection) return <LanguageGate />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<MatchesPage />} />
        <Route path="matches/:id" element={<MatchDetailPage />} />
        <Route path="me" element={<MyPage />} />
        <Route path="me/settings" element={<SettingsPage />} />
        <Route path="me/settings/language" element={<LanguageSettingsPage />} />
        <Route path="me/registrations" element={<MyRegistrationsPage />} />
        <Route path="me/payment" element={<PaymentInfoPage />} />
        <Route path="legal/:type" element={<LegalPage />} />
      </Route>
    </Routes>
  );
}
