import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chooseLanguageAndRegion,
  json,
  mockApi,
  renderApp,
  setDeviceLanguages,
  signIn,
  type Api,
} from '../test-utils';

const PROMPT = '언어 선택 / Tilni tanlang / Select language';

let api: Api;
beforeEach(() => {
  api = mockApi();
  api.handlers['/v1/matches'] = () => json({ items: [], limit: 20, offset: 0 });
  api.handlers['/v1/regions'] = () =>
    json({
      items: [
        {
          id: 'r1',
          code: 'seoul',
          name: { text: 'Seoul', locale: 'en', isFallback: false },
          level: 1,
          upcomingMatches: 3,
          children: [],
        },
      ],
    });
  setDeviceLanguages(['en-US']);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('language selection', () => {
  it('shows the prompt in every supported language and offers all of them', () => {
    renderApp();
    expect(screen.getByRole('heading', { name: PROMPT })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '한국어' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'O‘zbekcha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument();
    expect(window.localStorage.getItem('foodboll.language')).toBeNull();
  });

  it('suggests the device language without choosing it or skipping the prompt', () => {
    setDeviceLanguages(['uz-UZ']);
    renderApp();
    expect(screen.getByRole('button', { name: 'O‘zbekcha' })).toHaveClass(
      'gate__option--suggested',
    );
    expect(screen.getByRole('heading', { name: PROMPT })).toBeInTheDocument();
    expect(window.localStorage.getItem('foodboll.language')).toBeNull();
  });

  it('falls back to Korean for an unsupported device language and still asks', () => {
    setDeviceLanguages(['fr-FR']);
    renderApp();
    expect(screen.getByRole('button', { name: '한국어' })).toHaveClass('gate__option--suggested');
  });

  it('applies and remembers the choice, and sends nothing to an account that does not exist yet', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'O‘zbekcha' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Qayerda futbol o‘ynaysiz?' }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem('foodboll.language')).toBe('uz');
    expect(document.documentElement.lang).toBe('uz-Latn-UZ');
    expect(api.calls.filter((c) => c.init?.method === 'PATCH')).toEqual([]);
  });

  it('is skipped on later launches', () => {
    chooseLanguageAndRegion('ko');
    renderApp();
    expect(screen.queryByRole('heading', { name: PROMPT })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '매치' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('ko-KR');
  });

  it('ignores a corrupted stored value', () => {
    window.localStorage.setItem('foodboll.language', 'zz');
    renderApp();
    expect(screen.getByRole('heading', { name: PROMPT })).toBeInTheDocument();
  });
});

describe('region onboarding', () => {
  beforeEach(() => window.localStorage.setItem('foodboll.language', 'en'));

  it('asks where the player plays and remembers the choice', async () => {
    const user = userEvent.setup();
    renderApp();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Where do you play?' }),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Seoul/ }));

    expect(await screen.findByRole('link', { name: 'Matches' })).toBeInTheDocument();
    expect(window.localStorage.getItem('foodboll.region')).toBe('seoul');
    await waitFor(() =>
      expect(api.calls.some((c) => c.url.pathname === '/api/v1/matches')).toBe(true),
    );
    expect(api.find('GET', '/v1/matches')?.url.searchParams.get('region')).toBe('seoul');
  });

  it('can be skipped to browse every region', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole('button', { name: 'Browse all regions' }));
    expect(await screen.findByRole('link', { name: 'Matches' })).toBeInTheDocument();
    expect(window.localStorage.getItem('foodboll.region')).toBe('all');
    expect(api.find('GET', '/v1/matches')?.url.searchParams.has('region')).toBe(false);
  });

  it('does not block a shared link to one match', async () => {
    api.handlers['/v1/matches/m1'] = () =>
      json({ error: { code: 'MATCH_NOT_FOUND', message: '' } }, 404);
    renderApp('/matches/m1');
    expect(await screen.findByText('We couldn’t find this match.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Where do you play?' })).not.toBeInTheDocument();
  });

  it('does not ask a signed-in player whose account already has a region', async () => {
    signIn(api, {
      id: 'u1',
      displayName: 'Aziz',
      role: 'PLAYER',
      preferredLanguage: 'en',
      effectiveLanguage: 'en',
      depositorName: null,
      homeRegion: {
        id: 'r1',
        code: 'seoul',
        name: { text: 'Seoul', locale: 'en', isFallback: false },
        level: 1,
        parent: null,
      },
    });
    renderApp();
    expect(await screen.findByRole('link', { name: 'Matches' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Where do you play?' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(api.calls.some((c) => c.url.pathname === '/api/v1/matches')).toBe(true),
    );
    // The feed waited for the account instead of fetching every region first.
    const feedCalls = api.calls.filter((c) => c.url.pathname === '/api/v1/matches');
    expect(feedCalls.map((c) => c.url.searchParams.get('region'))).toEqual(['seoul']);
  });
});
