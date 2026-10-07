import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { lazy, Suspense } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthProvider';
import { ErrorBoundary } from '../features/shell/ErrorBoundary';
import { I18nProvider } from '../i18n/I18nProvider';
import { PageHeader } from '../ui/PageHeader';
import { ToastProvider, useToast } from '../ui/Toast';
import {
  apiError,
  chooseLanguageAndRegion,
  json,
  matchDetail,
  me,
  mockApi,
  registration,
  renderApp,
  setDeviceLanguages,
  signIn,
  type Api,
} from '../test-utils';

let api: Api;
beforeEach(() => {
  api = mockApi();
  setDeviceLanguages(['en-US']);
  chooseLanguageAndRegion('en', 'all');
  api.handlers['/v1/matches'] = () => json({ items: [], limit: 20, offset: 0 });
  api.handlers['/v1/auth/config'] = () => json({ telegramBotUsername: null, devLogin: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const bodyOf = (call: { init: RequestInit | undefined } | undefined): unknown =>
  JSON.parse(String(call?.init?.body));
const authOf = (call: { init: RequestInit | undefined }) =>
  (call.init?.headers as Record<string, string>).Authorization;

describe('startup without AbortSignal.any (older iOS)', () => {
  it('still renders a signed-in user instead of a blank screen', async () => {
    const original = AbortSignal.any;
    // @ts-expect-error simulate a browser that predates AbortSignal.any
    delete AbortSignal.any;
    try {
      signIn(api, me({ preferredLanguage: 'uz', effectiveLanguage: 'uz' }));
      window.localStorage.removeItem('foodboll.language');
      renderApp();
      expect(await screen.findByRole('link', { name: 'Matchlar' })).toBeInTheDocument();
      expect(window.localStorage.getItem('foodboll.language')).toBe('uz');
    } finally {
      AbortSignal.any = original;
    }
  });

  it('gives up on a hanging API after the timeout and shows the language screen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.localStorage.removeItem('foodboll.language');
    window.localStorage.setItem('foodboll.accessToken', 'a.b.c');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: unknown, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      ),
    );
    renderApp();
    await act(() => vi.advanceTimersByTimeAsync(5_100));
    expect(
      await screen.findByRole('heading', { name: /Tilni tanlang|Select language/ }),
    ).toBeInTheDocument();
  });
});

describe('language save', () => {
  it('pushes a choice that never reached the account instead of adopting the stale one', async () => {
    chooseLanguageAndRegion('uz', 'all');
    window.localStorage.setItem('foodboll.languageUnsaved', '1');
    signIn(api, me({ preferredLanguage: 'ko', effectiveLanguage: 'ko' }));
    renderApp();

    await waitFor(() =>
      expect(bodyOf(api.find('PATCH', '/v1/me/language'))).toMatchObject({
        preferredLanguage: 'uz',
      }),
    );
    expect(window.localStorage.getItem('foodboll.language')).toBe('uz');
    await waitFor(() => expect(window.localStorage.getItem('foodboll.languageUnsaved')).toBeNull());
  });

  it('adopts the account language when nothing is waiting to be saved', async () => {
    chooseLanguageAndRegion('uz', 'all');
    signIn(api, me({ preferredLanguage: 'ko', effectiveLanguage: 'ko' }));
    renderApp();
    await waitFor(() => expect(window.localStorage.getItem('foodboll.language')).toBe('ko'));
  });

  it('remembers a failed save so the next launch retries it', async () => {
    chooseLanguageAndRegion('en', 'all');
    signIn(api, me({ preferredLanguage: 'en' }));
    api.handlers['/v1/me/language'] = (_url, init) =>
      String(init?.body).includes('preferredLanguage')
        ? apiError('INTERNAL_ERROR', 500)
        : json(me());
    const user = userEvent.setup();
    renderApp('/settings');
    await user.click(await screen.findByRole('radio', { name: 'O‘zbekcha' }));
    await waitFor(() => expect(window.localStorage.getItem('foodboll.languageUnsaved')).toBe('1'));
  });

  it('sends one save at a time and the latest choice wins', async () => {
    signIn(api, me({ preferredLanguage: 'en' }));
    const releases: (() => void)[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const sent: string[] = [];
    api.handlers['/v1/me/language'] = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { preferredLanguage?: string };
      if (!body.preferredLanguage) return json(me());
      sent.push(body.preferredLanguage);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => releases.push(resolve));
      inFlight -= 1;
      return json(me({ preferredLanguage: body.preferredLanguage }));
    };
    const user = userEvent.setup();
    renderApp('/settings');
    await user.click(await screen.findByRole('radio', { name: 'O‘zbekcha' }));
    await user.click(await screen.findByRole('radio', { name: '한국어' }));
    await user.click(await screen.findByRole('radio', { name: 'English' }));
    await waitFor(() => expect(sent).toEqual(['uz']));
    releases.shift()?.();
    await waitFor(() => expect(sent).toEqual(['uz', 'en']));
    releases.shift()?.();
    await waitFor(() => expect(window.localStorage.getItem('foodboll.languageUnsaved')).toBeNull());
    expect(maxInFlight).toBe(1);
    expect(window.localStorage.getItem('foodboll.language')).toBe('en');
  });
});

describe('auth across tabs', () => {
  const tabChange = (token: string | null) => {
    if (token === null) window.localStorage.removeItem('foodboll.accessToken');
    else window.localStorage.setItem('foodboll.accessToken', token);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'foodboll.accessToken' }));
    });
  };

  it('signs this tab out when another tab signs out', async () => {
    signIn(api);
    renderApp('/me');
    expect(
      await screen.findByRole('link', { name: /My registrations|Settings/ }),
    ).toBeInTheDocument();
    const before = api.calls.length;

    tabChange(null);
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    // Nothing is requested anonymously on behalf of the account the tab believed it had.
    expect(
      api.calls.slice(before).filter((c) => c.url.pathname === '/api/v1/me/notifications'),
    ).toHaveLength(0);
  });

  it('follows another tab that signed in as someone else', async () => {
    signIn(api);
    renderApp('/me');
    await screen.findByRole('button', { name: 'Log out' });
    const profileCalls = () => api.calls.filter((c) => c.url.pathname === '/api/v1/me/profile');
    expect(profileCalls().every((c) => authOf(c) === 'Bearer a.b.c')).toBe(true);

    tabChange('p.2.x');
    // The new account's data is requested with the new token, never the old one.
    await waitFor(() =>
      expect(profileCalls().at(-1) && authOf(profileCalls().at(-1)!)).toBe('Bearer p.2.x'),
    );
  });

  it('signs this tab in when another tab signed in', async () => {
    renderApp('/me');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    signIn(api);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'foodboll.accessToken' }));
    });
    expect(await screen.findByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });

  it('ignores unrelated storage keys', async () => {
    signIn(api);
    renderApp('/me');
    await screen.findByRole('button', { name: 'Log out' });
    const before = api.calls.length;
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'foodboll.region' }));
    });
    expect(api.calls.length).toBe(before);
  });
});

describe('error boundary', () => {
  function renderInShell(children: React.ReactNode) {
    const queryClient = new QueryClient();
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AuthProvider>
            <I18nProvider>{children}</I18nProvider>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('shows a localized fallback with a reload button when a screen throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    function Broken(): never {
      throw new Error('boom');
    }
    renderInShell(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    expect(
      await screen.findByText(
        'Something went wrong while showing this screen. Reload the page to continue.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('is shown in the user’s language', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    chooseLanguageAndRegion('ko', 'all');
    function Broken(): never {
      throw new Error('boom');
    }
    renderInShell(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    expect(await screen.findByRole('button', { name: '새로고침' })).toBeInTheDocument();
  });

  it('catches a lazy chunk that fails to load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Chunk = lazy<React.ComponentType>(() =>
      Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
    );
    renderInShell(
      <ErrorBoundary>
        <Suspense fallback={null}>
          <Chunk />
        </Suspense>
      </ErrorBoundary>,
    );
    expect(await screen.findByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('clears the error when the boundary is keyed to a new screen', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Broken(): never {
      throw new Error('boom');
    }
    const queryClient = new QueryClient();
    const tree = (path: string) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AuthProvider>
            <I18nProvider>
              <ErrorBoundary key={path}>{path === '/' ? <Broken /> : <p>fine</p>}</ErrorBoundary>
            </I18nProvider>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
    const { rerender } = render(tree('/'));
    expect(await screen.findByRole('button', { name: 'Reload' })).toBeInTheDocument();
    rerender(tree('/ok'));
    expect(await screen.findByText('fine')).toBeInTheDocument();
  });
});

describe('cancelled after paying', () => {
  const cancelledWith = (status: string) =>
    registration({
      status: 'CANCELLED',
      payment: {
        status,
        amountKrw: 10000,
        dueAt: '2030-05-04T01:00:00.000Z',
        referenceCode: '4307',
        hasReceipt: true,
        rejectReason: null,
      },
    });

  beforeEach(() => signIn(api));

  it('shows the refund is being processed', async () => {
    api.handlers['/v1/registrations/r1'] = () => json(cancelledWith('REFUND_PENDING'));
    renderApp('/registrations/r1');
    expect(await screen.findByText('Registration cancelled')).toBeInTheDocument();
    expect(screen.getByText('Your refund is being processed.')).toBeInTheDocument();
    expect(screen.getByText('Refund pending')).toBeInTheDocument();
  });

  it('shows the payment was refunded', async () => {
    api.handlers['/v1/registrations/r1'] = () => json(cancelledWith('REFUNDED'));
    renderApp('/registrations/r1');
    expect(await screen.findByText('Your payment was refunded.')).toBeInTheDocument();
  });

  it('shows the refund state on the My matches card', async () => {
    api.handlers['/v1/me/registrations'] = () =>
      json({ items: [cancelledWith('REFUND_PENDING')], limit: 50, offset: 0 });
    const user = userEvent.setup();
    renderApp('/my-matches');
    await user.click(await screen.findByRole('tab', { name: /Past/ }));
    const card = await screen.findByRole('link', { name: /Gangnam Friday futsal/ });
    expect(within(card).getByText('Cancelled')).toBeInTheDocument();
    expect(within(card).getByText('Refund pending')).toBeInTheDocument();
  });

  it('does not offer Join while the refund is pending, but links to the refund status', async () => {
    api.handlers['/v1/matches/m1'] = () =>
      json(matchDetail({ viewer: { registrationId: 'r1', status: 'CANCELLED' } }));
    api.handlers['/v1/matches/m1/players'] = () => json({ items: [] });
    renderApp('/matches/m1');
    const link = await screen.findByRole('link', { name: 'Refund pending' });
    expect(link).toHaveAttribute('href', '/registrations/r1');
    expect(screen.queryByRole('button', { name: /Join match/ })).not.toBeInTheDocument();
  });
});

describe('back arrow', () => {
  function Screen() {
    return <PageHeader back title="x" />;
  }
  function Go() {
    const navigate = useNavigate();
    return (
      <button type="button" onClick={() => void navigate('/deep')}>
        open
      </button>
    );
  }
  const wrap = (node: React.ReactNode) => (
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>{node}</AuthProvider>
    </QueryClientProvider>
  );

  it('goes to the feed on a deep link with no in-app history', async () => {
    render(
      wrap(
        <I18nProvider>
          <MemoryRouter initialEntries={['/deep']}>
            <Routes>
              <Route path="/" element={<p>feed</p>} />
              <Route path="/deep" element={<Screen />} />
            </Routes>
          </MemoryRouter>
        </I18nProvider>,
      ),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(await screen.findByText('feed')).toBeInTheDocument();
  });

  it('goes back one step when the user arrived inside the app', async () => {
    render(
      wrap(
        <I18nProvider>
          <MemoryRouter initialEntries={['/']}>
            <Routes>
              <Route
                path="/"
                element={
                  <>
                    <p>feed</p>
                    <Go />
                  </>
                }
              />
              <Route path="/deep" element={<Screen />} />
            </Routes>
          </MemoryRouter>
        </I18nProvider>,
      ),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'open' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(await screen.findByText('feed')).toBeInTheDocument();
  });

  it('works end to end on a shared match link', async () => {
    api.handlers['/v1/matches/m1'] = () => json(matchDetail());
    api.handlers['/v1/matches/m1/players'] = () => json({ items: [] });
    renderApp('/matches/m1');
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('link', { name: 'Matches' })).toBeInTheDocument();
  });
});

describe('developer sign-in role', () => {
  async function openDevForm() {
    api.handlers['/v1/matches/m1'] = () => json(matchDetail());
    api.handlers['/v1/matches/m1/players'] = () => json({ items: [] });
    api.handlers['/v1/auth/dev-login'] = () =>
      json({
        accessToken: 'new.token.value',
        expiresAt: '2030-01-01T00:00:00.000Z',
        user: { id: 'u1', displayName: 'Aziz' },
      });
    api.handlers['/v1/me'] = () => json(me());
    api.handlers['/v1/me/notifications'] = () =>
      json({ items: [], limit: 50, offset: 0, unread: 0 });
    renderApp('/matches/m1');
    await userEvent.click(await screen.findByRole('button', { name: 'Log in to join' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(await within(dialog).findByLabelText('Name'), 'Aziz');
    return dialog;
  }

  it('sends no role unless the user changed it', async () => {
    const dialog = await openDevForm();
    expect(within(dialog).getByLabelText('Role')).toHaveValue('PLAYER');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(api.find('POST', '/v1/auth/dev-login')).toBeDefined());
    expect(bodyOf(api.find('POST', '/v1/auth/dev-login'))).toEqual({ name: 'Aziz' });
  });

  it('sends the chosen role', async () => {
    const dialog = await openDevForm();
    await userEvent.selectOptions(within(dialog).getByLabelText('Role'), 'ADMIN');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(api.find('POST', '/v1/auth/dev-login')).toBeDefined());
    expect(bodyOf(api.find('POST', '/v1/auth/dev-login'))).toEqual({ name: 'Aziz', role: 'ADMIN' });
  });
});

describe('route title and focus', () => {
  it('sets the document title per screen and moves focus to the main region on navigation', async () => {
    signIn(api);
    const user = userEvent.setup();
    renderApp('/');
    await waitFor(() => expect(document.title).toBe('Matches · Foodboll'));

    await user.click(await screen.findByRole('link', { name: 'My page' }));
    await waitFor(() => expect(document.title).toBe('My page · Foodboll'));
    await waitFor(() => expect(document.getElementById('main')).toHaveFocus());
  });

  it('does not steal focus on the first render', async () => {
    renderApp('/');
    await screen.findByRole('link', { name: 'Matches' });
    expect(document.getElementById('main')).not.toHaveFocus();
  });

  it('falls back to the app name on unknown routes', async () => {
    renderApp('/nowhere');
    await waitFor(() => expect(document.title).toBe('Foodboll'));
  });
});

describe('timers are cleared on unmount', () => {
  function Shower() {
    const toast = useToast();
    return (
      <button type="button" onClick={() => toast.show('hello')}>
        show
      </button>
    );
  }

  it('does not leave the toast timer running after the provider unmounts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { unmount } = render(
      <ToastProvider>
        <Shower />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'show' }));
    expect(screen.getByText('hello')).toBeInTheDocument();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
