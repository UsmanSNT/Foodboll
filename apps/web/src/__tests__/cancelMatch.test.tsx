import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chooseLanguageAndRegion,
  gangnam,
  json,
  matchDetail,
  matchSummary,
  me,
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
  api.handlers['/v1/payment-instructions/current'] = () => json(paymentInstruction);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const CANCELLED_AT = '2030-05-01T00:00:00.000Z';
const BANNER = 'This match was cancelled. If you paid, your payment will be refunded.';
const cancelledMatch = (overrides: Record<string, unknown> = {}) =>
  matchDetail({ cancelledAt: CANCELLED_AT, ...overrides });

describe('match page of a cancelled match', () => {
  it('shows a prominent banner and a disabled Cancelled button instead of Join', async () => {
    api.handlers['/v1/matches/m1'] = () => json(cancelledMatch());
    renderApp('/matches/m1');

    expect(await screen.findByText(BANNER)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(BANNER);
    expect(screen.getByRole('button', { name: 'Cancelled' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Join match/ })).not.toBeInTheDocument();
  });

  it('shows no banner for a match that is on, and keeps Join', async () => {
    signIn(api);
    api.handlers['/v1/matches/m1/players'] = () => json({ items: [] });
    api.handlers['/v1/matches/m1'] = () => json(matchDetail());
    renderApp('/matches/m1');

    expect(await screen.findByRole('button', { name: /Join match/ })).toBeEnabled();
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
  });

  it('points a player who had joined to their registration', async () => {
    signIn(api);
    api.handlers['/v1/matches/m1/players'] = () => json({ items: [] });
    api.handlers['/v1/matches/m1'] = () =>
      json(cancelledMatch({ viewer: { registrationId: 'r1', status: 'CANCELLED' } }));
    renderApp('/matches/m1');

    expect(await screen.findByText(BANNER)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View my registration' })).toHaveAttribute(
      'href',
      '/registrations/r1',
    );
    expect(screen.getByRole('button', { name: 'Cancelled' })).toBeDisabled();
  });
});

describe('cancelling from the match page', () => {
  it('is offered to an admin, who must confirm in the sheet before anything is sent', async () => {
    signIn(api, me({ role: 'ADMIN' }));
    api.handlers['/v1/matches/m1/players'] = () => json({ items: [] });
    let cancelled = false;
    api.handlers['/v1/matches/m1'] = () =>
      json(matchDetail({ cancelledAt: cancelled ? CANCELLED_AT : null }));
    api.handlers['/v1/matches/m1/cancel'] = () => {
      cancelled = true;
      return json(cancelledMatch());
    };
    const user = userEvent.setup();
    renderApp('/matches/m1');

    await user.click(await screen.findByRole('button', { name: /^Cancel match/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel this match?' });
    expect(within(dialog).getByText('Gangnam Friday futsal')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Everyone who joined is notified that the match was cancelled.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/marked as waiting for a refund/)).toBeInTheDocument();
    expect(within(dialog).getByText(/can’t be undone/)).toBeInTheDocument();
    expect(api.find('POST', '/v1/matches/m1/cancel')).toBeUndefined();

    await user.click(within(dialog).getByRole('button', { name: 'Yes, cancel the match' }));
    await waitFor(() => expect(api.find('POST', '/v1/matches/m1/cancel')).toBeDefined());
    expect(await screen.findByText(BANNER)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Cancel match/ })).not.toBeInTheDocument();
  });

  it('is not offered to an organizer on the public match page (they use their own screens)', async () => {
    signIn(api, me({ role: 'ORGANIZER' }));
    api.handlers['/v1/matches/m1/players'] = () => json({ items: [] });
    api.handlers['/v1/matches/m1'] = () => json(matchDetail());
    renderApp('/matches/m1');
    await screen.findByRole('button', { name: /Join match/ });
    expect(screen.queryByRole('button', { name: /^Cancel match/ })).not.toBeInTheDocument();
  });

  it('is not offered for a match that already started', async () => {
    signIn(api, me({ role: 'ADMIN' }));
    api.handlers['/v1/matches/m1/players'] = () => json({ items: [] });
    api.handlers['/v1/matches/m1'] = () =>
      json(
        matchDetail({
          startsAt: '2020-01-01T10:00:00.000Z',
          endsAt: '2020-01-01T12:00:00.000Z',
        }),
      );
    renderApp('/matches/m1');
    await screen.findByRole('button', { name: 'Already started' });
    expect(screen.queryByRole('button', { name: /^Cancel match/ })).not.toBeInTheDocument();
  });

  it('shows the localized reason when the server refuses', async () => {
    signIn(api, me({ role: 'ADMIN' }));
    api.handlers['/v1/matches/m1/players'] = () => json({ items: [] });
    api.handlers['/v1/matches/m1'] = () => json(matchDetail());
    api.handlers['/v1/matches/m1/cancel'] = () =>
      json({ error: { code: 'MATCH_CANCELLED', message: 'ignored' } }, 409);
    const user = userEvent.setup();
    renderApp('/matches/m1');

    await user.click(await screen.findByRole('button', { name: /^Cancel match/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel this match?' });
    await user.click(within(dialog).getByRole('button', { name: 'Yes, cancel the match' }));
    expect(await within(dialog).findByText('This match was cancelled.')).toBeInTheDocument();
  });
});

describe('organizer home', () => {
  const page = (items: unknown[]) => json({ items, limit: 20, offset: 0 });
  beforeEach(() => {
    signIn(api, me({ role: 'ORGANIZER' }));
    api.handlers['/v1/me/organizer-regions'] = () => json({ items: [gangnam] });
  });

  it('cancels an upcoming match after a confirmation, and refreshes the list', async () => {
    let cancelled = false;
    api.handlers['/v1/me/organized-matches'] = () =>
      page([matchSummary({ cancelledAt: cancelled ? CANCELLED_AT : null })]);
    api.handlers['/v1/matches/m1/cancel'] = () => {
      cancelled = true;
      return json(cancelledMatch());
    };
    const user = userEvent.setup();
    renderApp('/organizer');

    await user.click(
      await screen.findByRole('button', { name: 'Cancel match: Gangnam Friday futsal' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Cancel this match?' });
    expect(api.find('POST', '/v1/matches/m1/cancel')).toBeUndefined();
    await user.click(within(dialog).getByRole('button', { name: 'Yes, cancel the match' }));

    await waitFor(() => expect(api.find('POST', '/v1/matches/m1/cancel')).toBeDefined());
    expect(await screen.findByText('The match was cancelled')).toBeInTheDocument();
    // The match leaves Upcoming and sits under Past, marked as cancelled, without edit actions.
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Gangnam Friday futsal' }),
      ).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole('tab', { name: 'Past' }));
    const card = (await screen.findByRole('heading', { name: 'Gangnam Friday futsal' })).closest(
      'article',
    );
    const scope = within(card as HTMLElement);
    expect(scope.getByText('Cancelled')).toBeInTheDocument();
    expect(scope.queryByRole('link', { name: /^Edit/ })).not.toBeInTheDocument();
    expect(scope.queryByRole('link', { name: /^Roster/ })).not.toBeInTheDocument();
    expect(scope.queryByRole('button', { name: /^Cancel match/ })).not.toBeInTheDocument();
    expect(scope.getByRole('link', { name: 'View: Gangnam Friday futsal' })).toBeInTheDocument();
  });

  it('offers no cancel button for a match that has started', async () => {
    api.handlers['/v1/me/organized-matches'] = () =>
      page([
        matchSummary({
          startsAt: new Date(Date.now() - 3_600_000).toISOString(),
          endsAt: new Date(Date.now() + 3_600_000).toISOString(),
        }),
      ]);
    renderApp('/organizer');
    await screen.findByRole('heading', { name: 'Gangnam Friday futsal' });
    expect(screen.queryByRole('button', { name: /^Cancel match/ })).not.toBeInTheDocument();
  });
});

describe('players see the cancellation in their own screens', () => {
  const refundPending = {
    status: 'REFUND_PENDING',
    amountKrw: 10000,
    dueAt: '2030-05-04T01:00:00.000Z',
    referenceCode: null,
    hasReceipt: false,
    rejectReason: null,
  };
  const cancelledRegistration = () =>
    registration({
      status: 'CANCELLED',
      match: matchSummary({
        cancelledAt: CANCELLED_AT,
        viewer: { registrationId: 'r1', status: 'CANCELLED' },
      }),
      payment: refundPending,
    });

  beforeEach(() => signIn(api));

  it('registration page: says the match was cancelled and that the payment will be refunded', async () => {
    api.handlers['/v1/registrations/r1'] = () => json(cancelledRegistration());
    renderApp('/registrations/r1');

    expect(
      await screen.findByText(
        'This match was cancelled, so your registration was cancelled too. If you paid, your payment will be refunded; the team will contact you.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Your refund is being processed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel registration' })).not.toBeInTheDocument();
  });

  it('My matches: marks the card with the cancellation message', async () => {
    api.handlers['/v1/me/registrations'] = () =>
      json({ items: [cancelledRegistration()], limit: 100, offset: 0 });
    const user = userEvent.setup();
    renderApp('/my-matches');

    await user.click(await screen.findByRole('tab', { name: /Past/ }));
    expect(await screen.findByText(BANNER)).toBeInTheDocument();
    expect(screen.getByText('Refund pending')).toBeInTheDocument();
  });
});
