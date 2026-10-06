import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  chooseLanguageAndRegion,
  json,
  matchDetail,
  mockApi,
  paymentInstruction,
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
  api.handlers['/v1/auth/config'] = () => json({ telegramBotUsername: null, devLogin: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const korean = (text: string, isFallback: boolean) => ({ text, locale: 'ko', isFallback });

describe('match page: localized content', () => {
  it('asks the server for the reader language and tells Uzbek readers when they see the original', async () => {
    chooseLanguageAndRegion('uz', 'all');
    api.handlers['/v1/matches/m1'] = () =>
      json(
        matchDetail({ title: korean('강남 금요 풋살', true), rules: korean('풋살 규칙', true) }),
      );
    renderApp('/matches/m1');

    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('강남 금요 풋살');
    expect(heading).toHaveAttribute('lang', 'ko');
    expect(screen.getAllByText('Asl matn (한국어) ko‘rsatilmoqda.').length).toBeGreaterThan(0);
    expect(screen.getByText('6x6')).toBeInTheDocument();
    expect(api.find('GET', '/v1/matches/m1')?.url.searchParams.get('lang')).toBe('uz');
  });

  it('shows no notice when the content is already in the reader language', async () => {
    chooseLanguageAndRegion('ko', 'all');
    api.handlers['/v1/matches/m1'] = () =>
      json(matchDetail({ title: korean('강남 금요 풋살', false) }));
    renderApp('/matches/m1');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText(/원문/)).not.toBeInTheDocument();
  });

  it('shows the time range in Korean time, including the day', async () => {
    api.handlers['/v1/matches/m1'] = () => json(matchDetail());
    renderApp('/matches/m1');
    expect(await screen.findByText('22:00–00:00')).toBeInTheDocument();
    expect(screen.getByText('Sat, May 4')).toBeInTheDocument();
    expect(screen.getByText('Korea time')).toBeInTheDocument();
  });

  it('renders organizer text as text, never as HTML', async () => {
    api.handlers['/v1/matches/m1'] = () =>
      json(
        matchDetail({
          title: { text: '<img src=x onerror=alert(1)>', locale: 'en', isFallback: false },
          description: { text: '<script>alert(1)</script>', locale: 'en', isFallback: false },
        }),
      );
    const { container } = renderApp('/matches/m1');
    await screen.findByRole('heading', { level: 1 });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('opens the venue in a maps search without leaking the page to it', async () => {
    api.handlers['/v1/matches/m1'] = () =>
      json(matchDetail({ venueAddress: '서울 강남구 테헤란로 1' }));
    renderApp('/matches/m1');
    const link = await screen.findByRole('link', { name: 'Open in maps' });
    expect(link).toHaveAttribute(
      'href',
      `https://map.naver.com/p/search/${encodeURIComponent('서울 강남구 테헤란로 1')}`,
    );
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows a friendly message for an unknown match', async () => {
    api.handlers['/v1/matches/missing'] = () => apiError('MATCH_NOT_FOUND', 404);
    renderApp('/matches/missing');
    expect(
      await screen.findByRole('heading', { name: 'We couldn’t find this match.' }),
    ).toBeInTheDocument();
  });

  it('shows a localized error, not server text, for other failures', async () => {
    api.handlers['/v1/matches/broken'] = () => apiError('INTERNAL_ERROR', 500);
    renderApp('/matches/broken');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again in a moment.',
    );
    expect(screen.queryByText('ignored')).not.toBeInTheDocument();
  });

  it('lists who is going for a signed-in player, linking to their profiles', async () => {
    signIn(api);
    api.handlers['/v1/matches/m1'] = () => json(matchDetail());
    api.handlers['/v1/matches/m1/players'] = () =>
      json({
        items: [
          {
            id: 'p1',
            displayName: 'Dilnoza',
            homeRegion: null,
            level: { level: 2, xp: 30, xpIntoLevel: 10, xpForNextLevel: 30 },
          },
        ],
      });
    renderApp('/matches/m1');
    const link = await screen.findByRole('link', { name: /Dilnoza/ });
    expect(link).toHaveAttribute('href', '/players/p1');
    expect(within(link).getByText('Lv. 2')).toBeInTheDocument();
  });
});

describe('joining a match', () => {
  it('asks a visitor to log in first, then signs in with the sheet', async () => {
    api.handlers['/v1/matches/m1'] = () => json(matchDetail());
    api.handlers['/v1/auth/dev-login'] = () =>
      json({
        accessToken: 'new.token.value',
        expiresAt: '2030-01-01T00:00:00.000Z',
        user: { id: 'u1', displayName: 'Aziz' },
      });
    signInAfterLogin();
    const user = userEvent.setup();
    renderApp('/matches/m1');

    await user.click(await screen.findByRole('button', { name: 'Log in to join' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(await within(dialog).findByLabelText('Name'), 'Aziz');
    await user.click(within(dialog).getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('button', { name: /Join match/ })).toBeInTheDocument();
    expect(window.localStorage.getItem('foodboll.accessToken')).toBe('new.token.value');
  });

  it('registers and lands on the payment page', async () => {
    signIn(api);
    api.handlers['/v1/matches/m1'] = () => json(matchDetail());
    api.handlers['/v1/matches/m1/players'] = () => json({ items: [] });
    api.handlers['/v1/matches/m1/registrations'] = () => json(registration(), 201);
    api.handlers['/v1/registrations/r1'] = () => json(registration());
    api.handlers['/v1/payment-instructions/current'] = () => json(paymentInstruction);
    const user = userEvent.setup();
    renderApp('/matches/m1');

    await user.click(await screen.findByRole('button', { name: 'Join match · ₩10,000' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your registration' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('4307')).toBeInTheDocument();
    expect(api.find('POST', '/v1/matches/m1/registrations')).toBeDefined();
  });

  it('shows a localized error when the match filled up meanwhile', async () => {
    signIn(api);
    api.handlers['/v1/matches/m1'] = () => json(matchDetail());
    api.handlers['/v1/matches/m1/players'] = () => json({ items: [] });
    api.handlers['/v1/matches/m1/registrations'] = () => apiError('MATCH_FULL', 409);
    const user = userEvent.setup();
    renderApp('/matches/m1');
    await user.click(await screen.findByRole('button', { name: /Join match/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This match is full.');
  });

  it('cannot join a full or started match', async () => {
    signIn(api);
    api.handlers['/v1/matches/full'] = () =>
      json(matchDetail({ id: 'full', spotsLeft: 0, registeredCount: 18 }));
    api.handlers['/v1/matches/full/players'] = () => json({ items: [] });
    renderApp('/matches/full');
    expect(await screen.findByRole('button', { name: 'Full' })).toBeDisabled();
  });

  it('cannot join a match that already started', async () => {
    signIn(api);
    api.handlers['/v1/matches/old'] = () =>
      json(
        matchDetail({
          id: 'old',
          startsAt: '2020-01-01T10:00:00.000Z',
          endsAt: '2020-01-01T12:00:00.000Z',
        }),
      );
    api.handlers['/v1/matches/old/players'] = () => json({ items: [] });
    renderApp('/matches/old');
    expect(await screen.findByRole('button', { name: 'Already started' })).toBeDisabled();
  });

  it('links to the existing registration instead of offering to join twice', async () => {
    signIn(api);
    api.handlers['/v1/matches/m1'] = () =>
      json(matchDetail({ viewer: { registrationId: 'r1', status: 'APPLIED' } }));
    api.handlers['/v1/matches/m1/players'] = () => json({ items: [] });
    renderApp('/matches/m1');
    expect(await screen.findByRole('link', { name: 'View my registration' })).toHaveAttribute(
      'href',
      '/registrations/r1',
    );
    expect(screen.queryByRole('button', { name: /Join match/ })).not.toBeInTheDocument();
  });
});

/** After the dev login the app asks for the account, so the mock must now answer as a signed-in API. */
function signInAfterLogin() {
  api.handlers['/v1/me'] = () =>
    json({
      id: 'u1',
      displayName: 'Aziz',
      role: 'PLAYER',
      preferredLanguage: 'en',
      effectiveLanguage: 'en',
      depositorName: null,
      homeRegion: null,
    });
  api.handlers['/v1/me/notifications'] = () => json({ items: [], limit: 50, offset: 0, unread: 0 });
  api.handlers['/v1/matches/m1/players'] = () => json({ items: [] });
}
