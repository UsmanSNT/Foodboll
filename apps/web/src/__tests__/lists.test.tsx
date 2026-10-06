import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseLanguageAndRegion, json, matchSummary, mockApi, registration, renderApp, setDeviceLanguages, signIn, type Api } from '../test-utils';

let api: Api;
beforeEach(() => {
  api = mockApi();
  setDeviceLanguages(['en-US']);
  chooseLanguageAndRegion('en', 'all');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const card = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  displayName: name,
  homeRegion: null,
  level: { level: 3, xp: 60, xpIntoLevel: 10, xpForNextLevel: 50 },
  ...overrides,
});

describe('my matches', () => {
  it('splits upcoming from past and cancelled, with the payment state on each', async () => {
    signIn(api);
    const past = matchSummary({ id: 'old', startsAt: '2020-01-01T10:00:00.000Z', endsAt: '2020-01-01T12:00:00.000Z', title: { text: 'Old match', locale: 'en', isFallback: false } });
    api.handlers['/v1/me/registrations'] = () =>
      json({
        items: [
          registration({ id: 'r1' }),
          registration({ id: 'r2', status: 'CONFIRMED', match: past, payment: null }),
          registration({ id: 'r3', status: 'CANCELLED', match: matchSummary({ id: 'm3', title: { text: 'Cancelled one', locale: 'en', isFallback: false } }) }),
        ],
        limit: 100,
        offset: 0,
      });
    const user = userEvent.setup();
    renderApp('/my-matches');

    const upcoming = await screen.findByRole('link', { name: /Gangnam Friday futsal/ });
    expect(upcoming).toHaveAttribute('href', '/registrations/r1');
    expect(within(upcoming).getByText('Awaiting payment')).toBeInTheDocument();
    expect(within(upcoming).getByText('Pay now')).toBeInTheDocument();
    expect(screen.queryByText('Old match')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Past (2)' }));
    expect(screen.getByRole('link', { name: /Old match/ })).toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: /Cancelled one/ })).getByText('Cancelled')).toBeInTheDocument();
  });

  it('asks a visitor to log in', async () => {
    renderApp('/my-matches');
    expect(await screen.findByRole('heading', { name: 'Log in to see your matches' })).toBeInTheDocument();
  });

  it('points to the feed when there is nothing yet', async () => {
    signIn(api);
    api.handlers['/v1/me/registrations'] = () => json({ items: [], limit: 100, offset: 0 });
    renderApp('/my-matches');
    expect(await screen.findByRole('heading', { name: 'No upcoming matches' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Find a match' })).toHaveAttribute('href', '/');
  });
});

describe('players', () => {
  it('requires an account', async () => {
    renderApp('/players');
    expect(await screen.findByRole('heading', { name: 'Log in to find players' })).toBeInTheDocument();
    expect(api.calls.some((c) => c.url.pathname === '/api/v1/players')).toBe(false);
  });

  it('lists players and searches by name once the player stops typing', async () => {
    signIn(api);
    api.handlers['/v1/players'] = (url) =>
      json({ items: url.searchParams.get('q') ? [card('p2', 'Aziz Karimov')] : [card('p1', 'Dilnoza'), card('p2', 'Aziz Karimov')], limit: 30, offset: 0 });
    const user = userEvent.setup();
    renderApp('/players');

    expect(await screen.findByRole('link', { name: /Dilnoza/ })).toHaveAttribute('href', '/players/p1');
    await user.type(screen.getByRole('searchbox', { name: 'Search by name' }), 'aziz');
    await waitFor(() => expect(screen.queryByRole('link', { name: /Dilnoza/ })).not.toBeInTheDocument());
    expect(api.calls.filter((c) => c.url.pathname === '/api/v1/players').at(-1)?.url.searchParams.get('q')).toBe('aziz');
    // Typing is debounced: one request per pause, not one per keystroke.
    expect(api.calls.filter((c) => c.url.pathname === '/api/v1/players').length).toBeLessThanOrEqual(3);
  });

  it('shows a message when nobody matches', async () => {
    signIn(api);
    api.handlers['/v1/players'] = () => json({ items: [], limit: 30, offset: 0 });
    renderApp('/players');
    expect(await screen.findByRole('heading', { name: 'No results found.' })).toBeInTheDocument();
  });
});

describe('player profile', () => {
  const profile = {
    ...card('p1', 'Dilnoza', { homeRegion: matchSummary().region, level: { level: 4, xp: 190, xpIntoLevel: 10, xpForNextLevel: 120 } }),
    role: 'PLAYER',
    memberSince: '2030-01-15T00:00:00.000Z',
    xp: 190,
    stats: { matchesPlayed: 12, matchesOrganized: 1, noShows: 0, attendanceRate: 1, last90Days: 5, firstMatchAt: null, lastMatchAt: null, provincesPlayed: 1 },
    activity: 'REGULAR',
    achievements: ['FIRST_MATCH', 'MATCHES_10'],
    recentMatches: [matchSummary()],
  };

  it('shows level, activity, games played, achievements and recent matches', async () => {
    signIn(api);
    api.handlers['/v1/players/p1'] = () => json(profile);
    renderApp('/players/p1');

    expect(await screen.findByRole('heading', { level: 1, name: 'Dilnoza' })).toBeInTheDocument();
    expect(screen.getByText('Lv. 4')).toBeInTheDocument();
    expect(screen.getByText('Regular')).toBeInTheDocument();
    expect(screen.getByText('110 experience points to next level')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('First match')).toBeInTheDocument();
    expect(screen.getByText('10 matches played')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Gangnam Friday futsal/ })).toBeInTheDocument();
    expect(screen.getByText('Member since: Jan 15, 2030')).toBeInTheDocument();
  });

  it('does not show contact or payment details (the API never sends them)', async () => {
    signIn(api);
    api.handlers['/v1/players/p1'] = () => json(profile);
    const { container } = renderApp('/players/p1');
    await screen.findByRole('heading', { level: 1, name: 'Dilnoza' });
    expect(container.textContent).not.toMatch(/telegram|phone|account number|depositor/i);
  });
});

describe('notifications', () => {
  it('lists notifications in the player language and marks them read', async () => {
    signIn(api);
    api.handlers['/v1/me/notifications'] = (url, init) =>
      init?.method === 'POST'
        ? json({ ok: true })
        : json({
            items: [
              { id: 'n1', type: 'PAYMENT_CONFIRMED', title: 'Payment confirmed', body: 'Your payment has been confirmed.', createdAt: '2030-05-01T00:00:00.000Z', readAt: null },
              { id: 'n2', type: 'PAYMENT_REFUNDED', title: 'Refund completed', body: 'Your payment has been refunded.', createdAt: '2030-04-01T00:00:00.000Z', readAt: '2030-04-02T00:00:00.000Z' },
            ],
            limit: 50,
            offset: 0,
            unread: 1,
          });
    api.handlers['/v1/me/notifications/read'] = () => json({ ok: true });
    const user = userEvent.setup();
    renderApp('/notifications');

    expect(await screen.findByRole('heading', { name: 'Payment confirmed' })).toBeInTheDocument();
    expect(screen.getByText('Your payment has been refunded.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark all as read' }));
    await waitFor(() => expect(api.find('POST', '/v1/me/notifications/read')?.init?.body).toBe(JSON.stringify({ all: true })));
  });

  it('shows an empty state', async () => {
    signIn(api);
    renderApp('/notifications');
    expect(await screen.findByRole('heading', { name: 'No notifications yet' })).toBeInTheDocument();
  });
});
