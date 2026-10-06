import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatDate } from '@foodboll/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { upcomingDays } from '../lib/dates';
import { chooseLanguageAndRegion, json, matchSummary, mockApi, renderApp, setDeviceLanguages, signIn, type Api } from '../test-utils';

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

const page = (items: unknown[]) => json({ items, limit: 20, offset: 0 });

describe('match feed', () => {
  it('groups matches by Korean day and shows when, where, how full and the price', async () => {
    api.handlers['/v1/matches'] = () =>
      page([
        matchSummary({ id: 'm1' }),
        // 2030-05-04 22:00 KST → same Korean day as m1; the next one is after midnight KST.
        matchSummary({ id: 'm2', startsAt: '2030-05-04T15:30:00.000Z', endsAt: '2030-05-04T17:00:00.000Z', title: { text: 'Late match', locale: 'en', isFallback: false } }),
        matchSummary({ id: 'm3', startsAt: '2030-05-05T10:00:00.000Z', endsAt: '2030-05-05T12:00:00.000Z', spotsLeft: 0, registeredCount: 18, title: { text: 'Sunday match', locale: 'en', isFallback: false } }),
      ]);
    renderApp();

    expect(await screen.findByRole('heading', { name: 'Sat, May 4' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sun, May 5' })).toBeInTheDocument();

    const first = screen.getByRole('link', { name: /Gangnam Friday futsal/ });
    expect(first).toHaveAttribute('href', '/matches/m1');
    expect(within(first).getByText('22:00')).toBeInTheDocument();
    expect(within(first).getByText('4 spots left')).toBeInTheDocument();
    expect(within(first).getByText('₩10,000')).toBeInTheDocument();
    expect(within(first).getByText(/강남 풋살파크 · Seoul Gangnam-gu/)).toBeInTheDocument();

    const full = screen.getByRole('link', { name: /Sunday match/ });
    expect(within(full).getByText('Full')).toBeInTheDocument();
  });

  it('shows the signed-in player their own status on a card', async () => {
    signIn(api);
    api.handlers['/v1/matches'] = () =>
      page([
        matchSummary({ id: 'm1', viewer: { registrationId: 'r1', status: 'CONFIRMED' } }),
        matchSummary({ id: 'm2', title: { text: 'Other', locale: 'en', isFallback: false }, viewer: { registrationId: 'r2', status: 'APPLIED' } }),
      ]);
    renderApp();
    expect(await screen.findByText('Joined')).toBeInTheDocument();
    expect(screen.getByText('Registered')).toBeInTheDocument();
  });

  it('explains an empty feed and offers to widen the search', async () => {
    chooseLanguageAndRegion('en', 'seoul');
    api.handlers['/v1/matches'] = () => page([]);
    api.handlers['/v1/regions'] = () => json({ items: [{ id: 'r', code: 'seoul', name: { text: 'Seoul', locale: 'en', isFallback: false }, level: 1, upcomingMatches: 0, children: [] }] });
    const user = userEvent.setup();
    renderApp();

    expect(await screen.findByRole('heading', { name: 'No matches here yet' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all regions' }));
    await waitFor(() => expect(api.calls.at(-1)?.url.searchParams.has('region')).toBe(false));
    expect(window.localStorage.getItem('foodboll.region')).toBe('all');
  });

  it('filters by the chosen day, in Korean dates', async () => {
    api.handlers['/v1/matches'] = () => page([matchSummary()]);
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('link', { name: /Gangnam Friday futsal/ });

    const day = upcomingDays(5)[3]!;
    await user.click(screen.getByRole('button', { name: formatDate('en', `${day.key}T12:00:00+09:00`) }));
    await waitFor(() => expect(api.calls.at(-1)?.url.searchParams.get('date')).toBe(day.key));
  });

  it('changes region from the pill and asks the server for that region', async () => {
    api.handlers['/v1/matches'] = () => page([matchSummary()]);
    api.handlers['/v1/regions'] = () =>
      json({
        items: [
          { id: 'a', code: 'busan', name: { text: 'Busan', locale: 'en', isFallback: false }, level: 1, upcomingMatches: 2, children: [] },
        ],
      });
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('link', { name: /Gangnam Friday futsal/ });

    await user.click(screen.getByRole('button', { name: 'Change region' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('button', { name: /Busan/ }));

    await waitFor(() => expect(api.calls.at(-1)?.url.searchParams.get('region')).toBe('busan'));
    expect(window.localStorage.getItem('foodboll.region')).toBe('busan');
  });

  it('shows a localized error and can retry', async () => {
    let fail = true;
    api.handlers['/v1/matches'] = () => (fail ? json({ error: { code: 'INTERNAL_ERROR', message: '' } }, 500) : page([matchSummary()]));
    const user = userEvent.setup();
    renderApp();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again in a moment.');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: /Gangnam Friday futsal/ })).toBeInTheDocument();
  });
});
