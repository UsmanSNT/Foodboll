import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chooseLanguageAndRegion,
  json,
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
  signIn(api);
  api.handlers['/v1/payment-instructions/current'] = () => json(paymentInstruction);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const payment = (overrides: Record<string, unknown>) => ({
  status: 'AWAITING_PAYMENT',
  amountKrw: 10000,
  dueAt: '2030-05-04T01:00:00.000Z',
  referenceCode: '4307',
  hasReceipt: false,
  rejectReason: null,
  ...overrides,
});
const serve = (reg: unknown) => {
  api.handlers['/v1/registrations/r1'] = () => json(reg);
};

describe('paying for a match', () => {
  it('shows the amount, the account, the payment code and the fallback options', async () => {
    serve(registration());
    renderApp('/registrations/r1');

    expect(await screen.findByText('₩10,000')).toBeInTheDocument();
    expect(await screen.findByText('Shinhan Bank')).toBeInTheDocument();
    expect(screen.getByText('110-123-456789')).toBeInTheDocument();
    expect(screen.getByText('김풋볼')).toBeInTheDocument();
    expect(screen.getByText('4307')).toBeInTheDocument();
    expect(screen.getByText('Put your payment code in the sender memo.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Can’t add a memo?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload payment receipt' })).toBeEnabled();
    expect(
      screen.getByText('Most payments are confirmed within a few minutes.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Awaiting payment')).toBeInTheDocument();
  });

  it('copies the account number as digits only, and the payment code as is', async () => {
    serve(registration());
    const user = userEvent.setup();
    renderApp('/registrations/r1');
    await screen.findByText('4307');

    await user.click(screen.getByRole('button', { name: 'Copy: Account number' }));
    expect(await navigator.clipboard.readText()).toBe('110123456789');
    await user.click(screen.getByRole('button', { name: 'Copy: Your payment code' }));
    expect(await navigator.clipboard.readText()).toBe('4307');
  });

  it('saves the name shown by the player’s bank for matching deposits without a memo', async () => {
    serve(registration());
    api.handlers['/v1/me/depositor-name'] = () => json(me({ depositorName: 'Aziz Karimov' }));
    const user = userEvent.setup();
    renderApp('/registrations/r1');

    const input = await screen.findByLabelText('Name shown by your bank');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.type(input, '  Aziz Karimov ');
    await user.click(save);

    await waitFor(() => expect(api.find('PATCH', '/v1/me/depositor-name')).toBeDefined());
    expect(api.find('PATCH', '/v1/me/depositor-name')?.init?.body).toBe(
      JSON.stringify({ depositorName: 'Aziz Karimov' }),
    );
  });

  it('prefills the saved name', async () => {
    signIn(api, me({ depositorName: 'Aziz Karimov' }));
    serve(registration());
    renderApp('/registrations/r1');
    expect(await screen.findByLabelText('Name shown by your bank')).toHaveValue('Aziz Karimov');
  });

  it('uploads a receipt as the raw file with its own content type', async () => {
    serve(registration());
    api.handlers['/v1/registrations/r1/receipt'] = () => json(registration());
    const user = userEvent.setup();
    renderApp('/registrations/r1');
    await screen.findByText('4307');

    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'receipt.png', {
      type: 'image/png',
    });
    await user.upload(screen.getByTestId('receipt-input'), file);

    await waitFor(() => {
      const put = api.find('PUT', '/v1/registrations/r1/receipt');
      expect((put?.init?.headers as Record<string, string>)['Content-Type']).toBe('image/png');
      expect(put?.init?.body).toBe(file);
    });
  });

  it('rejects unsupported and oversized files on the device without sending anything', async () => {
    serve(registration());
    const user = userEvent.setup({ applyAccept: false });
    renderApp('/registrations/r1');
    await screen.findByText('4307');

    await user.upload(
      screen.getByTestId('receipt-input'),
      new File(['hi'], 'x.txt', { type: 'text/plain' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only JPG, PNG or PDF files can be uploaded.',
    );

    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    await user.upload(screen.getByTestId('receipt-input'), big);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This file is too large. Please upload a smaller file.',
    );
    expect(api.calls.some((c) => c.init?.method === 'PUT')).toBe(false);
  });
});

describe('every payment state', () => {
  it('explains a rejection in the player language and offers a new upload', async () => {
    serve(
      registration({
        payment: payment({
          status: 'PAYMENT_REJECTED',
          hasReceipt: true,
          rejectReason: 'AMOUNT_MISMATCH',
        }),
      }),
    );
    renderApp('/registrations/r1');
    expect(await screen.findByText(/We couldn’t confirm your payment\./)).toHaveTextContent(
      'Reason: The payment amount doesn’t match',
    );
    expect(screen.getByRole('button', { name: 'Upload payment receipt' })).toBeEnabled();
    expect(screen.getByText('4307')).toBeInTheDocument();
  });

  it('says it is being checked while a receipt is under review, with nothing to do', async () => {
    serve(registration({ payment: payment({ status: 'PAYMENT_REVIEW', hasReceipt: true }) }));
    renderApp('/registrations/r1');
    expect(
      await screen.findByText('We are checking your payment. Please wait a moment.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Upload payment receipt' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('4307')).not.toBeInTheDocument();
  });

  it('celebrates a confirmed payment and completes the steps', async () => {
    serve(
      registration({
        status: 'CONFIRMED',
        payment: payment({ status: 'PAYMENT_CONFIRMED', referenceCode: null }),
      }),
    );
    renderApp('/registrations/r1');
    expect(await screen.findByText('Payment confirmed. See you on the pitch.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Upload payment receipt' }),
    ).not.toBeInTheDocument();
  });

  it('confirms a free match immediately', async () => {
    serve(registration({ status: 'CONFIRMED', payment: null }));
    renderApp('/registrations/r1');
    expect(
      await screen.findByText('This match is free, so your participation is confirmed right away.'),
    ).toBeInTheDocument();
  });

  it('tells the player about refunds', async () => {
    serve(registration({ status: 'CANCELLED', payment: payment({ status: 'REFUND_PENDING' }) }));
    renderApp('/registrations/r1');
    expect(await screen.findByText('Registration cancelled')).toBeInTheDocument();
  });

  it('says a lapsed unpaid seat was released', async () => {
    serve(
      registration({
        status: 'CANCELLED',
        payment: payment({ dueAt: '2020-01-01T00:00:00.000Z' }),
      }),
    );
    renderApp('/registrations/r1');
    expect(
      await screen.findByText('Your spot was released because payment wasn’t received in time.'),
    ).toBeInTheDocument();
  });

  it('refreshes while payment is expected, so an automatic confirmation shows up by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let confirmed = false;
      api.handlers['/v1/registrations/r1'] = () =>
        json(
          confirmed
            ? registration({
                status: 'CONFIRMED',
                payment: payment({ status: 'PAYMENT_CONFIRMED', referenceCode: null }),
              })
            : registration(),
        );
      renderApp('/registrations/r1');
      await screen.findByText('4307');
      confirmed = true;
      await vi.advanceTimersByTimeAsync(16_000);
      expect(
        await screen.findByText('Payment confirmed. See you on the pitch.'),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('cancelling', () => {
  it('asks first, then cancels', async () => {
    serve(registration());
    api.handlers['/v1/registrations/r1/cancel'] = () => json(registration({ status: 'CANCELLED' }));
    const user = userEvent.setup();
    renderApp('/registrations/r1');

    await user.click(await screen.findByRole('button', { name: 'Cancel registration' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel this registration?' });
    expect(within(dialog).queryByText(/refund/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel registration' }));

    await waitFor(() => expect(api.find('POST', '/v1/registrations/r1/cancel')).toBeDefined());
  });

  it('warns that a paid registration is refunded by the team', async () => {
    serve(
      registration({
        status: 'CONFIRMED',
        payment: payment({ status: 'PAYMENT_CONFIRMED', referenceCode: null }),
      }),
    );
    const user = userEvent.setup();
    renderApp('/registrations/r1');
    await user.click(await screen.findByRole('button', { name: 'Cancel registration' }));
    expect(
      await screen.findByText('If you already paid, the team will handle your refund.'),
    ).toBeInTheDocument();
  });

  it('can keep the spot instead', async () => {
    serve(registration());
    const user = userEvent.setup();
    renderApp('/registrations/r1');
    await user.click(await screen.findByRole('button', { name: 'Cancel registration' }));
    await user.click(await screen.findByRole('button', { name: 'Keep my spot' }));
    expect(api.find('POST', '/v1/registrations/r1/cancel')).toBeUndefined();
  });

  it('is not offered once the match has started', async () => {
    serve(
      registration({
        match: {
          ...registration().match,
          startsAt: '2020-01-01T10:00:00.000Z',
          endsAt: '2020-01-01T12:00:00.000Z',
        },
      }),
    );
    renderApp('/registrations/r1');
    await screen.findByText('4307');
    expect(screen.queryByRole('button', { name: 'Cancel registration' })).not.toBeInTheDocument();
  });
});

describe('access', () => {
  it('asks a signed-out visitor to log in', async () => {
    window.localStorage.removeItem('foodboll.accessToken');
    renderApp('/registrations/r1');
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument();
    expect(api.calls.some((c) => c.url.pathname === '/api/v1/registrations/r1')).toBe(false);
  });

  it('does not reveal another player’s registration', async () => {
    api.handlers['/v1/registrations/r1'] = () =>
      json({ error: { code: 'REGISTRATION_NOT_FOUND', message: '' } }, 404);
    renderApp('/registrations/r1');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We couldn’t find this registration.',
    );
  });
});
