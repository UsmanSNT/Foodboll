import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';
import { LoginGateProvider } from './auth/useRequireLogin';
import { I18nProvider } from './i18n/I18nProvider';
import { RegionProvider } from './region/RegionProvider';
import { ToastProvider } from './ui/Toast';

type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const apiError = (code: string, status: number) =>
  json({ error: { code, message: 'ignored' } }, status);

export interface Call {
  readonly url: URL;
  readonly init: RequestInit | undefined;
}

export interface Api {
  /** Routes by pathname (without the `/api` prefix); unknown routes answer 404. */
  readonly handlers: Record<string, Handler>;
  readonly calls: Call[];
  find(method: string, path: string): Call | undefined;
}

/** Replaces `fetch` with an in-memory API. Call once per test (or in beforeEach). */
export function mockApi(): Api {
  const handlers: Record<string, Handler> = {};
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      calls.push({ url, init });
      const handler = handlers[url.pathname.replace(/^\/api/, '')];
      return handler ? handler(url, init) : apiError('NOT_FOUND', 404);
    }),
  );
  return {
    handlers,
    calls,
    find: (method, path) =>
      calls.find((c) => (c.init?.method ?? 'GET') === method && c.url.pathname === `/api${path}`),
  };
}

export function setDeviceLanguages(languages: string[]) {
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(languages);
  vi.spyOn(window.navigator, 'language', 'get').mockReturnValue(languages[0] ?? 'en');
}

export function renderApp(path = '/') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
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
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---- Fixtures ---------------------------------------------------------------------------------

const localized = (text: string, locale = 'en', isFallback = false) => ({
  text,
  locale,
  isFallback,
});

export const seoul = {
  id: 'r-seoul',
  code: 'seoul',
  name: localized('Seoul'),
  level: 1,
  parent: null,
};
export const gangnam = {
  id: 'r-gangnam',
  code: 'seoul-gangnam',
  name: localized('Gangnam-gu'),
  level: 2,
  parent: { id: 'r-seoul', code: 'seoul', name: localized('Seoul') },
};

export function matchSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    startsAt: '2030-05-04T13:00:00.000Z',
    endsAt: '2030-05-04T15:00:00.000Z',
    venueName: '강남 풋살파크',
    venueAddress: null,
    region: gangnam,
    playersPerSide: 6,
    maxPlayers: 18,
    registeredCount: 14,
    spotsLeft: 4,
    feeKrw: 10000,
    sourceLanguage: 'ko',
    title: localized('Gangnam Friday futsal'),
    viewer: null,
    ...overrides,
  };
}

export function matchDetail(overrides: Record<string, unknown> = {}) {
  return {
    ...matchSummary(),
    description: null,
    rules: null,
    locationInstructions: null,
    equipmentRequirements: null,
    cancellationPolicy: null,
    ...overrides,
  };
}

export function me(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    displayName: 'Aziz',
    role: 'PLAYER',
    preferredLanguage: 'en',
    effectiveLanguage: 'en',
    depositorName: null,
    homeRegion: null,
    ...overrides,
  };
}

export function registration(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    status: 'APPLIED',
    createdAt: '2030-04-01T00:00:00.000Z',
    match: matchSummary({ viewer: { registrationId: 'r1', status: 'APPLIED' } }),
    payment: {
      status: 'AWAITING_PAYMENT',
      amountKrw: 10000,
      dueAt: '2030-05-04T01:00:00.000Z',
      referenceCode: '4307',
      hasReceipt: false,
      rejectReason: null,
    },
    ...overrides,
  };
}

export const paymentInstruction = {
  id: 'p1',
  bankName: localized('Shinhan Bank'),
  accountNumber: '110-123-456789',
  accountHolder: '김풋볼',
  instructions: localized('Put your payment code in the sender memo.'),
};

/** Signs the test user in with the given account and the usual account endpoints. */
export function signIn(api: Api, account: Record<string, unknown> = me()) {
  window.localStorage.setItem('foodboll.accessToken', 'a.b.c');
  api.handlers['/v1/me'] = () => json(account);
  api.handlers['/v1/me/language'] = () => json(account);
  api.handlers['/v1/me/notifications'] = () => json({ items: [], limit: 50, offset: 0, unread: 0 });
}

/** A device that already chose a language and a region, so tests start on the screen they test. */
export function chooseLanguageAndRegion(language = 'en', region = 'all') {
  window.localStorage.setItem('foodboll.language', language);
  window.localStorage.setItem('foodboll.region', region);
}
