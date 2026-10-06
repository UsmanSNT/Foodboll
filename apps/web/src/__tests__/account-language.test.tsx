import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  chooseLanguageAndRegion,
  json,
  me,
  mockApi,
  renderApp,
  setDeviceLanguages,
  signIn,
  type Api,
} from '../test-utils';

let api: Api;
beforeEach(() => {
  api = mockApi();
  api.handlers['/v1/matches'] = () => json({ items: [], limit: 20, offset: 0 });
  setDeviceLanguages(['en-US']);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('language and the account', () => {
  it('switches instantly from settings and remembers it', async () => {
    chooseLanguageAndRegion('ko');
    const user = userEvent.setup();
    renderApp('/settings');

    await user.click(await screen.findByRole('radio', { name: 'O‘zbekcha' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sozlamalar' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'O‘zbekcha' })).toBeChecked();
    expect(window.localStorage.getItem('foodboll.language')).toBe('uz');
  });

  it('adopts the account language on a new device without showing the prompt', async () => {
    signIn(api, me({ preferredLanguage: 'uz', effectiveLanguage: 'uz', homeRegion: null }));
    window.localStorage.setItem('foodboll.region', 'all');
    renderApp();

    expect(await screen.findByRole('link', { name: 'Matchlar' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Tilni tanlang/ })).not.toBeInTheDocument();
    expect(window.localStorage.getItem('foodboll.language')).toBe('uz');
    const request = api.find('GET', '/v1/me');
    expect((request?.init?.headers as Record<string, string>).Authorization).toBe('Bearer a.b.c');
  });

  it('shows the prompt when the account has no language yet, then saves the choice to the account', async () => {
    signIn(api, me({ preferredLanguage: null, effectiveLanguage: 'ko' }));
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'O‘zbekcha' }));
    await waitFor(() =>
      expect(
        api.calls.some(
          (c) =>
            c.init?.method === 'PATCH' &&
            c.init.body === JSON.stringify({ preferredLanguage: 'uz' }),
        ),
      ).toBe(true),
    );
  });

  it('keeps the language applied locally and says so when saving to the account fails', async () => {
    chooseLanguageAndRegion('ko');
    signIn(api, me({ preferredLanguage: 'ko', effectiveLanguage: 'ko' }));
    api.handlers['/v1/me/language'] = (_url, init) =>
      init?.body && String(init.body).includes('preferredLanguage')
        ? apiError('INTERNAL_ERROR', 500)
        : json(me());
    const user = userEvent.setup();
    renderApp('/settings');

    await user.click(await screen.findByRole('radio', { name: 'O‘zbekcha' }));
    expect(
      await screen.findByText('Tilni hisobingizga saqlab bo‘lmadi. U ushbu qurilmada qo‘llanildi.'),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem('foodboll.language')).toBe('uz');
  });

  it('does not hang on a blank screen when the API is unreachable', async () => {
    window.localStorage.setItem('foodboll.accessToken', 'a.b.c');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    renderApp();
    expect(await screen.findByRole('heading', { name: /Tilni tanlang/ })).toBeInTheDocument();
  });
});
