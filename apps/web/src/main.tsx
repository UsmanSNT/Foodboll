import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';
import { LoginGateProvider } from './auth/useRequireLogin';
import { I18nProvider } from './i18n/I18nProvider';
import { RegionProvider } from './region/RegionProvider';
import { ToastProvider } from './ui/Toast';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/pages.css';
import './styles/organizer-home.css';
import './styles/match-form.css';
import './styles/admin-money.css';
import './styles/admin-people.css';
import './styles/admin-settings.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// A deploy removes old hashed chunks: reload once to pick up the new build. If it fails again the
// event is left alone, so the error boundary shows its reload screen instead of looping.
window.addEventListener('vite:preloadError', (event) => {
  try {
    const key = 'foodboll.chunkReload';
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, String(Date.now()));
    event.preventDefault();
    window.location.reload();
  } catch {
    /* storage unavailable: fall through to the error boundary */
  }
});
window.addEventListener('load', () => {
  window.setTimeout(() => {
    try {
      window.sessionStorage.removeItem('foodboll.chunkReload');
    } catch {
      /* storage unavailable */
    }
  }, 10_000);
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // Never hammer the API when it is down; one retry covers a dropped mobile connection.
      retry: 1,
    },
  },
});

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <I18nProvider>
            <RegionProvider>
              <ToastProvider>
                <LoginGateProvider>
                  <App />
                </LoginGateProvider>
              </ToastProvider>
            </RegionProvider>
          </I18nProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
