import type {
  AdminPaymentDto,
  BankDepositDto,
  BankDepositReason,
  BankDepositSource,
  BankDepositStatus,
  BankMatchMethod,
  MatchSummaryDto,
  PaymentRejectReason,
  PaymentStatus,
  RegistrationStatus,
} from '@foodboll/contracts';
import type { LocaleCode } from '@foodboll/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { filterCandidates } from '../features/admin/money/candidates';
import { mergeDepositPages } from '../features/admin/money/deposit-pages';
import { EXIT_MS, useResolution } from '../features/admin/money/resolution';
import {
  apiError,
  chooseLanguageAndRegion,
  json,
  matchSummary,
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
  setDeviceLanguages(['en-US']);
  chooseLanguageAndRegion('en', 'all');
  signIn(api, me({ role: 'ADMIN' }));
  URL.createObjectURL = vi.fn(() => 'blob:receipt');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---- Fixtures and helpers -----------------------------------------------------------------------

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const english = (text: string) => ({ text, locale: 'en', isFallback: false });
const bodyOf = (call: { init: RequestInit | undefined } | undefined): unknown =>
  JSON.parse(String(call?.init?.body));
const countCalls = (method: string, path: string) =>
  api.calls.filter(
    (call) => (call.init?.method ?? 'GET') === method && call.url.pathname === `/api${path}`,
  );

/** Answers a list endpoint like the API does: the requested window of a list. */
function slice(all: readonly unknown[], url: URL) {
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const limit = Number(url.searchParams.get('limit') ?? 20);
  return json({ items: all.slice(offset, offset + limit), limit, offset });
}

interface PaymentOptions {
  readonly name?: string;
  readonly language?: LocaleCode | null;
  readonly status?: PaymentStatus;
  readonly amountKrw?: number;
  readonly hasReceipt?: boolean;
  readonly referenceCode?: string | null;
  readonly rejectReason?: PaymentRejectReason | null;
  readonly registrationStatus?: RegistrationStatus;
  readonly receiptUploadedAt?: string | null;
  readonly matchTitle?: string;
}

function adminPayment(n: number, options: PaymentOptions = {}): AdminPaymentDto {
  const {
    name = 'Aziz Karimov',
    language = 'uz',
    status = 'PAYMENT_REVIEW',
    amountKrw = 10000,
    hasReceipt = true,
    referenceCode = '4307',
    rejectReason = null,
    registrationStatus = 'APPLIED',
    receiptUploadedAt = '2030-05-03T09:30:00.000Z',
    matchTitle = 'Gangnam Friday futsal',
  } = options;
  return {
    registrationId: uuid(n),
    user: { id: uuid(1000 + n), displayName: name, preferredLanguage: language },
    // The shared fixture is loosely typed (plain strings); the shape is the API's.
    match: matchSummary({ id: uuid(2000 + n), title: english(matchTitle) }) as MatchSummaryDto,
    registrationStatus,
    payment: {
      status,
      amountKrw,
      dueAt: '2030-05-04T01:00:00.000Z',
      referenceCode,
      hasReceipt,
      rejectReason,
    },
    receiptUploadedAt,
  };
}
type PaymentFixture = AdminPaymentDto;

const paymentPath = (n: number, action: string) =>
  `/v1/admin/registrations/${uuid(n)}/payment/${action}`;

/** Serves `/v1/admin/payments` from a mutable list, filtered by the requested status. */
function servePayments(list: () => readonly PaymentFixture[]) {
  api.handlers['/v1/admin/payments'] = (url) =>
    slice(
      list().filter((item) => item.payment.status === url.searchParams.get('status')),
      url,
    );
}

interface DepositOptions {
  readonly status?: BankDepositStatus;
  readonly source?: BankDepositSource;
  readonly reason?: BankDepositReason | null;
  readonly matchMethod?: BankMatchMethod | null;
  readonly amountKrw?: number | null;
  readonly receivedAt?: string;
  readonly rawText?: string;
}

function bankDeposit(n: number, options: DepositOptions = {}): BankDepositDto {
  const {
    status = 'UNMATCHED',
    source = 'WEBHOOK',
    reason = 'NO_CANDIDATE',
    matchMethod = null,
    amountKrw = 10000,
    receivedAt = '2030-05-03T12:00:00.000Z',
    rawText = `[신한] 05/03 21:00 입금 10,000원 홍길동 #${n}`,
  } = options;
  return {
    id: uuid(3000 + n),
    source,
    status,
    matchMethod,
    reason,
    amountKrw,
    receivedAt,
    rawText,
    matchedRegistrationId: null,
  };
}
type DepositFixture = BankDepositDto;

const depositPath = (n: number, action: string) =>
  `/v1/admin/bank-deposits/${uuid(3000 + n)}/${action}`;

function serveDeposits(list: () => readonly DepositFixture[]) {
  api.handlers['/v1/admin/bank-deposits'] = (url) =>
    slice(
      list().filter((item) => item.status === url.searchParams.get('status')),
      url,
    );
}

const dialogOf = async (name: string) => within(await screen.findByRole('dialog', { name }));

// ================================================================================================
// Payment review
// ================================================================================================

describe('payment review: the queue', () => {
  it('opens on receipts waiting for review and explains that most payments are automatic', async () => {
    servePayments(() => [adminPayment(1)]);
    renderApp('/admin/payments');

    expect(await screen.findByRole('article', { name: 'Aziz Karimov' })).toBeInTheDocument();
    const request = api.find('GET', '/v1/admin/payments');
    expect(request?.url.searchParams.get('status')).toBe('PAYMENT_REVIEW');
    expect(request?.url.searchParams.get('limit')).toBe('20');
    expect(request?.url.searchParams.get('offset')).toBe('0');
    expect(request?.url.searchParams.get('lang')).toBe('en');

    expect(screen.getByRole('heading', { level: 1, name: 'Payment review' })).toBeInTheDocument();
    expect(
      screen.getByText(/Most payments are confirmed automatically from bank deposit messages/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See bank deposits' })).toHaveAttribute(
      'href',
      '/admin/deposits',
    );
    expect(screen.getByRole('button', { name: 'Waiting for review' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('shows what is needed to check a receipt: player, language, match, amount, code and times', async () => {
    servePayments(() => [adminPayment(1)]);
    renderApp('/admin/payments');

    const card = within(await screen.findByRole('article', { name: 'Aziz Karimov' }));
    expect(card.getByRole('img', { name: 'Player language: O‘zbekcha' })).toHaveTextContent('UZ');
    expect(card.getByText('₩10,000')).toBeInTheDocument();
    expect(card.getByRole('link', { name: 'Gangnam Friday futsal' })).toHaveAttribute(
      'href',
      `/matches/${uuid(2001)}`,
    );
    expect(card.getByText('Sat, May 4, 2030 · 22:00')).toBeInTheDocument();
    expect(card.getByText('강남 풋살파크 · Seoul Gangnam-gu')).toBeInTheDocument();
    expect(card.getByText('Payment code')).toBeInTheDocument();
    expect(card.getByText('4307')).toBeInTheDocument();
    expect(card.getByText('Receipt uploaded')).toBeInTheDocument();
    expect(card.getByText('Fri, May 3, 2030 · 18:30')).toBeInTheDocument();
    expect(card.getByText('Due')).toBeInTheDocument();
    expect(card.getByText('Sat, May 4, 2030 · 10:00')).toBeInTheDocument();
  });

  it('keeps the order the API gives, and says when a player has not chosen a language', async () => {
    servePayments(() => [
      adminPayment(1, { name: 'Oldest', language: null }),
      adminPayment(2, { name: 'Newest', language: 'ko' }),
    ]);
    renderApp('/admin/payments');

    await screen.findByRole('article', { name: 'Oldest' });
    expect(
      screen.getAllByRole('article').map((card) => card.getAttribute('aria-labelledby')),
    ).toHaveLength(2);
    expect(screen.getAllByRole('article')[0]).toHaveAccessibleName('Oldest');
    expect(screen.getAllByRole('article')[1]).toHaveAccessibleName('Newest');
    expect(
      within(screen.getByRole('article', { name: 'Oldest' })).getByText('Language not set'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('article', { name: 'Newest' })).getByRole('img', {
        name: 'Player language: 한국어',
      }),
    ).toHaveTextContent('KO');
  });

  it('never shows database values, only catalog text', async () => {
    servePayments(() => [
      adminPayment(1, { status: 'PAYMENT_REJECTED', rejectReason: 'AMOUNT_MISMATCH' }),
    ]);
    const user = userEvent.setup();
    renderApp('/admin/payments');
    await user.click(await screen.findByRole('button', { name: 'Rejected' }));

    const card = within(await screen.findByRole('article', { name: 'Aziz Karimov' }));
    expect(card.getByText('The payment amount doesn’t match')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(
      /PAYMENT_REVIEW|PAYMENT_REJECTED|AMOUNT_MISMATCH|REFUND_PENDING/,
    );
  });

  it('flags a registration that was cancelled while it waited', async () => {
    servePayments(() => [adminPayment(1, { registrationStatus: 'CANCELLED' })]);
    renderApp('/admin/payments');
    expect(
      within(await screen.findByRole('article', { name: 'Aziz Karimov' })).getByText('Cancelled'),
    ).toBeInTheDocument();
  });

  it('switches queues with the chips, asking the API for each status', async () => {
    servePayments(() => [
      adminPayment(1, { name: 'Review one' }),
      adminPayment(2, {
        name: 'Refund one',
        status: 'REFUND_PENDING',
        hasReceipt: false,
        registrationStatus: 'CANCELLED',
      }),
      adminPayment(3, {
        name: 'Waiting one',
        status: 'AWAITING_PAYMENT',
        hasReceipt: false,
        receiptUploadedAt: null,
      }),
    ]);
    const user = userEvent.setup();
    renderApp('/admin/payments');
    await screen.findByRole('article', { name: 'Review one' });

    await user.click(screen.getByRole('button', { name: 'Refunds to process' }));
    expect(await screen.findByRole('article', { name: 'Refund one' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Review one' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refunds to process' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Waiting for review' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(api.calls.some((call) => call.url.searchParams.get('status') === 'REFUND_PENDING')).toBe(
      true,
    );

    await user.click(screen.getByRole('button', { name: 'Awaiting payment' }));
    const waiting = within(await screen.findByRole('article', { name: 'Waiting one' }));
    // Nothing to do for a payment that is still expected: it is confirmed automatically.
    expect(waiting.queryByRole('button')).not.toBeInTheDocument();
    expect(waiting.queryByText('Receipt uploaded')).not.toBeInTheDocument();
    expect(screen.getByText(/so there is nothing to do here/)).toBeInTheDocument();
  });

  it('can be opened on a queue through the address, and falls back for unknown values', async () => {
    servePayments(() => [
      adminPayment(2, { name: 'Refund one', status: 'REFUND_PENDING', hasReceipt: false }),
    ]);
    const { unmount } = renderApp('/admin/payments?status=REFUND_PENDING');
    expect(await screen.findByRole('article', { name: 'Refund one' })).toBeInTheDocument();
    expect(api.find('GET', '/v1/admin/payments')?.url.searchParams.get('status')).toBe(
      'REFUND_PENDING',
    );
    unmount();

    api.calls.length = 0;
    renderApp('/admin/payments?status=NOPE');
    await waitFor(() => expect(api.find('GET', '/v1/admin/payments')).toBeDefined());
    expect(api.find('GET', '/v1/admin/payments')?.url.searchParams.get('status')).toBe(
      'PAYMENT_REVIEW',
    );
  });

  it('shows an empty state per queue', async () => {
    servePayments(() => []);
    const user = userEvent.setup();
    renderApp('/admin/payments');
    expect(await screen.findByRole('heading', { name: 'Nothing to review' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refunds to process' }));
    expect(
      await screen.findByRole('heading', { name: 'No refunds to process' }),
    ).toBeInTheDocument();
  });

  it('loads more in pages of 20 without repeating anyone', async () => {
    const all = Array.from({ length: 21 }, (_, i) =>
      adminPayment(i + 1, { name: `Player ${i + 1}` }),
    );
    servePayments(() => all);
    const user = userEvent.setup();
    renderApp('/admin/payments');

    await screen.findByRole('article', { name: 'Player 1' });
    expect(screen.getAllByRole('article')).toHaveLength(20);
    await user.click(screen.getByRole('button', { name: 'Show more' }));

    expect(await screen.findByRole('article', { name: 'Player 21' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(21);
    const offsets = countCalls('GET', '/v1/admin/payments').map((call) =>
      call.url.searchParams.get('offset'),
    );
    expect(offsets).toEqual(['0', '20']);
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('explains a failure to load and tries again on request', async () => {
    let failing = true;
    api.handlers['/v1/admin/payments'] = (url) =>
      failing ? apiError('INTERNAL_ERROR', 500) : slice([adminPayment(1)], url);
    const user = userEvent.setup();
    renderApp('/admin/payments');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again in a moment.',
    );
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('article', { name: 'Aziz Karimov' })).toBeInTheDocument();
  });

  it('is only for administrators', async () => {
    signIn(api, me({ role: 'ORGANIZER' }));
    renderApp('/admin/payments');
    expect(
      await screen.findByRole('heading', { name: 'You don’t have permission to do this.' }),
    ).toBeInTheDocument();
    expect(api.calls.some((call) => call.url.pathname === '/api/v1/admin/payments')).toBe(false);
  });

  it('speaks Korean and Uzbek too', async () => {
    servePayments(() => [adminPayment(1)]);
    chooseLanguageAndRegion('ko', 'all');
    signIn(api, me({ role: 'ADMIN', preferredLanguage: 'ko', effectiveLanguage: 'ko' }));
    const { unmount } = renderApp('/admin/payments');
    expect(await screen.findByRole('heading', { level: 1, name: '결제 확인' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '확인: Aziz Karimov' })).toBeInTheDocument();
    unmount();

    chooseLanguageAndRegion('uz', 'all');
    signIn(api, me({ role: 'ADMIN', preferredLanguage: 'uz', effectiveLanguage: 'uz' }));
    renderApp('/admin/payments');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'To‘lovlarni tekshirish' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Tasdiqlash: Aziz Karimov' }),
    ).toBeInTheDocument();
  });
});

describe('payment review: confirming', () => {
  it('confirms with one tap, thanks the admin by name, folds the card away and refreshes the queue', async () => {
    let queue = [adminPayment(1, { name: 'First' }), adminPayment(2, { name: 'Second' })];
    servePayments(() => queue);
    api.handlers[paymentPath(1, 'confirm')] = () => {
      queue = queue.filter((item) => item.registrationId !== uuid(1));
      return json({});
    };
    const user = userEvent.setup();
    renderApp('/admin/payments');

    await user.click(await screen.findByRole('button', { name: 'Confirm: First' }));

    expect(await screen.findByText('Payment confirmed: First')).toBeInTheDocument();
    expect(api.find('POST', paymentPath(1, 'confirm'))).toBeDefined();
    // The card is inert and folding while it leaves, and the list is only refreshed afterwards.
    const leaving = screen.getByRole('article', { name: 'First' }).closest('li');
    expect(leaving).toHaveClass('money-item--leaving');
    expect(leaving).toHaveAttribute('inert');
    await waitFor(() =>
      expect(screen.queryByRole('article', { name: 'First' })).not.toBeInTheDocument(),
    );
    expect(countCalls('GET', '/v1/admin/payments').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('article', { name: 'Second' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Second' }).closest('li')).not.toHaveClass(
      'money-item--leaving',
    );
  });

  it('blocks a second tap while the confirmation is on its way', async () => {
    let release: () => void = () => undefined;
    api.handlers[paymentPath(1, 'confirm')] = () =>
      new Promise((resolve) => (release = () => resolve(json({}))));
    servePayments(() => [adminPayment(1)]);
    const user = userEvent.setup();
    renderApp('/admin/payments');

    const confirm = await screen.findByRole('button', { name: 'Confirm: Aziz Karimov' });
    await user.click(confirm);
    await waitFor(() => expect(confirm).toBeDisabled());
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    await user.click(confirm);
    release();
    await screen.findByText('Payment confirmed: Aziz Karimov');
    expect(countCalls('POST', paymentPath(1, 'confirm'))).toHaveLength(1);
  });

  it('can confirm several players in a row without waiting for each', async () => {
    const queue = [adminPayment(1, { name: 'First' }), adminPayment(2, { name: 'Second' })];
    servePayments(() => queue);
    api.handlers[paymentPath(1, 'confirm')] = () => json({});
    api.handlers[paymentPath(2, 'confirm')] = () => json({});
    const user = userEvent.setup();
    renderApp('/admin/payments');

    await user.click(await screen.findByRole('button', { name: 'Confirm: First' }));
    await user.click(screen.getByRole('button', { name: 'Confirm: Second' }));

    expect(await screen.findByText('Payment confirmed: First')).toBeInTheDocument();
    expect(await screen.findByText('Payment confirmed: Second')).toBeInTheDocument();
  });

  it('keeps the card and explains a failure, and the retry works', async () => {
    let failing = true;
    api.handlers[paymentPath(1, 'confirm')] = () =>
      failing ? apiError('INTERNAL_ERROR', 500) : json({});
    servePayments(() => [adminPayment(1)]);
    const user = userEvent.setup();
    renderApp('/admin/payments');

    const card = within(await screen.findByRole('article', { name: 'Aziz Karimov' }));
    await user.click(card.getByRole('button', { name: 'Confirm: Aziz Karimov' }));
    expect(await card.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again in a moment.',
    );
    expect(card.getByRole('button', { name: 'Confirm: Aziz Karimov' })).toBeEnabled();

    failing = false;
    await user.click(card.getByRole('button', { name: 'Confirm: Aziz Karimov' }));
    expect(await screen.findByText('Payment confirmed: Aziz Karimov')).toBeInTheDocument();
  });

  it('says so and refreshes when the automatic matcher confirmed it first', async () => {
    let queue = [adminPayment(1, { name: 'Taken' }), adminPayment(2, { name: 'Other' })];
    servePayments(() => queue);
    api.handlers[paymentPath(1, 'confirm')] = () => {
      // The bank deposit arrived while the admin was looking at the receipt.
      queue = queue.filter((item) => item.registrationId !== uuid(1));
      return apiError('INVALID_STATE', 409);
    };
    const user = userEvent.setup();
    renderApp('/admin/payments');

    await user.click(await screen.findByRole('button', { name: 'Confirm: Taken' }));

    expect(await screen.findByText('This action isn’t available right now.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('article', { name: 'Taken' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('article', { name: 'Other' })).toBeInTheDocument();
  });
});

describe('payment review: rejecting', () => {
  it('asks for a reason from the fixed list and sends its code', async () => {
    let queue = [adminPayment(1)];
    servePayments(() => queue);
    api.handlers[paymentPath(1, 'reject')] = () => {
      queue = [];
      return json({});
    };
    const user = userEvent.setup();
    renderApp('/admin/payments');

    await user.click(await screen.findByRole('button', { name: 'Reject: Aziz Karimov' }));
    const dialog = await dialogOf('Reject payment');
    expect(
      dialog.getByText('The player will see the reason and can upload a new receipt.'),
    ).toBeInTheDocument();
    // Who and what is being rejected is stated in the sheet itself.
    expect(dialog.getByText('Aziz Karimov')).toBeInTheDocument();
    expect(dialog.getByText('₩10,000')).toBeInTheDocument();
    const submit = dialog.getByRole('button', { name: 'Reject payment' });
    expect(submit).toBeDisabled();
    expect(
      dialog.getAllByRole('radio').map((radio) => (radio as HTMLInputElement).checked),
    ).toEqual([false, false, false, false]);
    expect(dialog.getByRole('group', { name: 'Reason' })).toBeInTheDocument();

    await user.click(dialog.getByRole('radio', { name: 'The receipt can’t be read' }));
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(await screen.findByText('Payment rejected: Aziz Karimov')).toBeInTheDocument();
    expect(bodyOf(api.find('POST', paymentPath(1, 'reject')))).toEqual({
      reason: 'RECEIPT_UNREADABLE',
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Reject payment' })).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.queryByRole('article', { name: 'Aziz Karimov' })).not.toBeInTheDocument(),
    );
  });

  it('offers every reason in the admin’s language and nothing else', async () => {
    servePayments(() => [adminPayment(1)]);
    const user = userEvent.setup();
    renderApp('/admin/payments');
    await user.click(await screen.findByRole('button', { name: 'Reject: Aziz Karimov' }));
    const dialog = await dialogOf('Reject payment');

    expect(
      dialog.getAllByRole('radio').map((radio) => radio.closest('label')?.textContent),
    ).toEqual([
      'The payment amount doesn’t match',
      'The receipt can’t be read',
      'We couldn’t find the payment',
      'Other',
    ]);
  });

  it('can be dismissed without sending anything', async () => {
    servePayments(() => [adminPayment(1)]);
    const user = userEvent.setup();
    renderApp('/admin/payments');
    await user.click(await screen.findByRole('button', { name: 'Reject: Aziz Karimov' }));
    const dialog = await dialogOf('Reject payment');
    await user.click(dialog.getByRole('radio', { name: 'Other' }));
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Reject payment' })).not.toBeInTheDocument(),
    );
    expect(api.calls.some((call) => call.init?.method === 'POST')).toBe(false);
  });

  it('shows a failure inside the sheet and keeps the chosen reason', async () => {
    api.handlers[paymentPath(1, 'reject')] = () => apiError('INTERNAL_ERROR', 500);
    servePayments(() => [adminPayment(1)]);
    const user = userEvent.setup();
    renderApp('/admin/payments');
    await user.click(await screen.findByRole('button', { name: 'Reject: Aziz Karimov' }));
    const dialog = await dialogOf('Reject payment');
    await user.click(dialog.getByRole('radio', { name: 'We couldn’t find the payment' }));
    await user.click(dialog.getByRole('button', { name: 'Reject payment' }));

    expect(await dialog.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again in a moment.',
    );
    expect(dialog.getByRole('radio', { name: 'We couldn’t find the payment' })).toBeChecked();
    expect(dialog.getByRole('button', { name: 'Reject payment' })).toBeEnabled();
  });
});

describe('payment review: refunds', () => {
  const refundPending = (n: number, name = 'Aziz Karimov') =>
    adminPayment(n, {
      name,
      status: 'REFUND_PENDING',
      registrationStatus: 'CANCELLED',
      hasReceipt: false,
    });

  it('offers refund and close, never confirm', async () => {
    servePayments(() => [refundPending(1)]);
    renderApp('/admin/payments?status=REFUND_PENDING');

    const card = within(await screen.findByRole('article', { name: 'Aziz Karimov' }));
    expect(
      card.getByRole('button', { name: 'Mark as refunded: Aziz Karimov' }),
    ).toBeInTheDocument();
    expect(
      card.getByRole('button', { name: 'Close without refund: Aziz Karimov' }),
    ).toBeInTheDocument();
    expect(card.queryByRole('button', { name: /^Confirm/ })).not.toBeInTheDocument();
    expect(card.queryByRole('button', { name: /^Reject/ })).not.toBeInTheDocument();
    expect(card.queryByRole('button', { name: /receipt/i })).not.toBeInTheDocument();
  });

  it('states the amount and that the money must be returned first, then records the refund', async () => {
    let queue = [refundPending(1)];
    servePayments(() => queue);
    api.handlers[paymentPath(1, 'refund')] = () => {
      queue = [];
      return json({});
    };
    const user = userEvent.setup();
    renderApp('/admin/payments?status=REFUND_PENDING');

    await user.click(await screen.findByRole('button', { name: 'Mark as refunded: Aziz Karimov' }));
    const dialog = await dialogOf('Mark as refunded?');
    expect(dialog.getByText('Amount to refund')).toBeInTheDocument();
    expect(dialog.getAllByText('₩10,000').length).toBeGreaterThan(0);
    expect(
      dialog.getByText(/Return the money to the player from your bank first/),
    ).toBeInTheDocument();
    expect(api.find('POST', paymentPath(1, 'refund'))).toBeUndefined();

    await user.click(dialog.getByRole('button', { name: 'Mark as refunded' }));

    expect(await screen.findByText('Refund recorded: Aziz Karimov')).toBeInTheDocument();
    expect(api.find('POST', paymentPath(1, 'refund'))).toBeDefined();
    await waitFor(() =>
      expect(screen.queryByRole('article', { name: 'Aziz Karimov' })).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByRole('heading', { name: 'No refunds to process' }),
    ).toBeInTheDocument();
  });

  it('does not record anything when the admin backs out', async () => {
    servePayments(() => [refundPending(1)]);
    const user = userEvent.setup();
    renderApp('/admin/payments?status=REFUND_PENDING');
    await user.click(await screen.findByRole('button', { name: 'Mark as refunded: Aziz Karimov' }));
    await user.click((await dialogOf('Mark as refunded?')).getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Mark as refunded?' })).not.toBeInTheDocument(),
    );
    expect(api.calls.some((call) => call.init?.method === 'POST')).toBe(false);
  });

  it('shows a refund failure in the sheet', async () => {
    api.handlers[paymentPath(1, 'refund')] = () => apiError('NETWORK_ERROR', 503);
    servePayments(() => [refundPending(1)]);
    const user = userEvent.setup();
    renderApp('/admin/payments?status=REFUND_PENDING');
    await user.click(await screen.findByRole('button', { name: 'Mark as refunded: Aziz Karimov' }));
    const dialog = await dialogOf('Mark as refunded?');
    await user.click(dialog.getByRole('button', { name: 'Mark as refunded' }));

    expect(await dialog.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Aziz Karimov' }).closest('li')).not.toHaveClass(
      'money-item--leaving',
    );
  });

  it('closes a cancelled registration whose money never arrived, with a reason and no refund', async () => {
    let queue = [refundPending(1)];
    servePayments(() => queue);
    api.handlers[paymentPath(1, 'reject')] = () => {
      queue = [];
      return json({});
    };
    const user = userEvent.setup();
    renderApp('/admin/payments?status=REFUND_PENDING');

    await user.click(
      await screen.findByRole('button', { name: 'Close without refund: Aziz Karimov' }),
    );
    const dialog = await dialogOf('Close without refund');
    expect(
      dialog.getByText(/Use this when the player cancelled and no money arrived/),
    ).toBeInTheDocument();
    await user.click(dialog.getByRole('radio', { name: 'We couldn’t find the payment' }));
    await user.click(dialog.getByRole('button', { name: 'Close without refund' }));

    expect(await screen.findByText('Payment rejected: Aziz Karimov')).toBeInTheDocument();
    expect(bodyOf(api.find('POST', paymentPath(1, 'reject')))).toEqual({
      reason: 'PAYMENT_NOT_FOUND',
    });
    expect(api.find('POST', paymentPath(1, 'refund'))).toBeUndefined();
  });
});

describe('payment review: receipts', () => {
  const serveReceipt = (n: number, contentType = 'image/png') => {
    api.handlers[`/v1/registrations/${uuid(n)}/receipt`] = () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': contentType },
      });
  };

  it('fetches the receipt with the session token, never cached, and shows it', async () => {
    servePayments(() => [adminPayment(1)]);
    serveReceipt(1);
    const user = userEvent.setup();
    renderApp('/admin/payments');

    await user.click(await screen.findByRole('button', { name: 'View receipt: Aziz Karimov' }));
    const dialog = await dialogOf('Receipt');

    const image = await dialog.findByRole('img', { name: 'Payment receipt from Aziz Karimov' });
    expect(image).toHaveAttribute('src', 'blob:receipt');
    const request = api.find('GET', `/v1/registrations/${uuid(1)}/receipt`);
    expect(request?.init?.headers).toEqual({ Authorization: 'Bearer a.b.c' });
    expect(request?.init?.cache).toBe('no-store');
    expect(
      dialog.getByText('Receipts show bank details. Don’t share or save them.'),
    ).toBeInTheDocument();
    // The decision is available right where the receipt is.
    expect(dialog.getByText('Aziz Karimov')).toBeInTheDocument();
    expect(dialog.getByText('4307')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Confirm: Aziz Karimov' })).toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: /^View receipt/ })).not.toBeInTheDocument();
  });

  it('opens an image in a new tab without giving the new page access to this one', async () => {
    servePayments(() => [adminPayment(1)]);
    serveReceipt(1);
    const user = userEvent.setup();
    renderApp('/admin/payments');
    await user.click(await screen.findByRole('button', { name: 'View receipt: Aziz Karimov' }));

    const link = await (await dialogOf('Receipt')).findByRole('link', { name: 'Open in new tab' });
    expect(link).toHaveAttribute('href', 'blob:receipt');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('opens a PDF through a link instead of embedding it', async () => {
    servePayments(() => [adminPayment(1)]);
    serveReceipt(1, 'application/pdf');
    const user = userEvent.setup();
    renderApp('/admin/payments');
    await user.click(await screen.findByRole('button', { name: 'View receipt: Aziz Karimov' }));
    const dialog = await dialogOf('Receipt');

    const link = await dialog.findByRole('link', { name: 'Open PDF' });
    expect(link).toHaveAttribute('href', 'blob:receipt');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(dialog.queryByRole('img')).not.toBeInTheDocument();
  });

  it('releases the receipt as soon as the sheet closes', async () => {
    servePayments(() => [adminPayment(1)]);
    serveReceipt(1);
    const user = userEvent.setup();
    renderApp('/admin/payments');
    await user.click(await screen.findByRole('button', { name: 'View receipt: Aziz Karimov' }));
    await (await dialogOf('Receipt')).findByRole('img');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    await user.click((await dialogOf('Receipt')).getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:receipt'));
    expect(screen.queryByRole('img', { name: /Payment receipt/ })).not.toBeInTheDocument();
  });

  it('never keeps a receipt that arrives after the sheet was closed', async () => {
    servePayments(() => [adminPayment(1)]);
    let release: () => void = () => undefined;
    api.handlers[`/v1/registrations/${uuid(1)}/receipt`] = () =>
      new Promise(
        (resolve) =>
          (release = () =>
            resolve(
              new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } }),
            )),
      );
    const user = userEvent.setup();
    renderApp('/admin/payments');
    await user.click(await screen.findByRole('button', { name: 'View receipt: Aziz Karimov' }));
    await user.click((await dialogOf('Receipt')).getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(api.find('GET', `/v1/registrations/${uuid(1)}/receipt`)).toBeDefined(),
    );

    release();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('explains when the receipt is gone', async () => {
    servePayments(() => [adminPayment(1)]);
    api.handlers[`/v1/registrations/${uuid(1)}/receipt`] = () => apiError('RECEIPT_NOT_FOUND', 404);
    const user = userEvent.setup();
    renderApp('/admin/payments');
    await user.click(await screen.findByRole('button', { name: 'View receipt: Aziz Karimov' }));

    expect(await (await dialogOf('Receipt')).findByRole('alert')).toHaveTextContent(
      'No receipt has been uploaded.',
    );
  });

  it('refuses to render anything that is not a receipt format', async () => {
    servePayments(() => [adminPayment(1)]);
    serveReceipt(1, 'text/html');
    const user = userEvent.setup();
    renderApp('/admin/payments');
    await user.click(await screen.findByRole('button', { name: 'View receipt: Aziz Karimov' }));

    expect(await (await dialogOf('Receipt')).findByRole('alert')).toHaveTextContent(
      'Only JPG, PNG or PDF files can be uploaded.',
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('is offered wherever a receipt exists, and not where none was uploaded', async () => {
    servePayments(() => [
      adminPayment(1, { name: 'Has receipt', status: 'PAYMENT_CONFIRMED', referenceCode: null }),
      adminPayment(2, {
        name: 'No receipt',
        status: 'PAYMENT_CONFIRMED',
        referenceCode: null,
        hasReceipt: false,
      }),
    ]);
    renderApp('/admin/payments?status=PAYMENT_CONFIRMED');

    expect(
      within(await screen.findByRole('article', { name: 'Has receipt' })).getByRole('button', {
        name: 'View receipt: Has receipt',
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('article', { name: 'No receipt' })).queryByRole('button'),
    ).not.toBeInTheDocument();
  });

  it('confirms straight from the receipt and closes it', async () => {
    let queue = [adminPayment(1)];
    servePayments(() => queue);
    serveReceipt(1);
    api.handlers[paymentPath(1, 'confirm')] = () => {
      queue = [];
      return json({});
    };
    const user = userEvent.setup();
    renderApp('/admin/payments');
    await user.click(await screen.findByRole('button', { name: 'View receipt: Aziz Karimov' }));
    const dialog = await dialogOf('Receipt');
    await dialog.findByRole('img');

    await user.click(dialog.getByRole('button', { name: 'Confirm: Aziz Karimov' }));

    expect(await screen.findByText('Payment confirmed: Aziz Karimov')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Receipt' })).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.queryByRole('article', { name: 'Aziz Karimov' })).not.toBeInTheDocument(),
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:receipt');
  });

  it('moves from the receipt to the rejection sheet and keeps that sheet open', async () => {
    servePayments(() => [adminPayment(1)]);
    serveReceipt(1);
    const user = userEvent.setup();
    renderApp('/admin/payments');
    await user.click(await screen.findByRole('button', { name: 'View receipt: Aziz Karimov' }));
    const receipt = await dialogOf('Receipt');
    await receipt.findByRole('img');

    await user.click(receipt.getByRole('button', { name: 'Reject: Aziz Karimov' }));

    const reject = await dialogOf('Reject payment');
    expect(reject.getAllByRole('radio')).toHaveLength(4);
    // The receipt sheet closing itself must not close the sheet that replaced it.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByRole('dialog', { name: 'Reject payment' })).toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:receipt');
  });
});

// ================================================================================================
// Bank deposits
// ================================================================================================

describe('bank deposits: the queue', () => {
  it('merges the unmatched and ambiguous deposits into one list, newest first', async () => {
    serveDeposits(() => [
      bankDeposit(1, { receivedAt: '2030-05-03T12:00:00.000Z', rawText: 'newest unmatched' }),
      bankDeposit(2, {
        status: 'AMBIGUOUS',
        reason: 'MULTIPLE_CANDIDATES',
        receivedAt: '2030-05-03T11:00:00.000Z',
        rawText: 'middle ambiguous',
      }),
      bankDeposit(3, { receivedAt: '2030-05-03T10:00:00.000Z', rawText: 'oldest unmatched' }),
    ]);
    renderApp('/admin/deposits');

    await screen.findByText('middle ambiguous');
    const cards = screen.getAllByRole('article');
    expect(cards.map((card) => card.querySelector('pre')?.textContent)).toEqual([
      'newest unmatched',
      'middle ambiguous',
      'oldest unmatched',
    ]);
    const statuses = countCalls('GET', '/v1/admin/bank-deposits').map((call) =>
      call.url.searchParams.get('status'),
    );
    expect(statuses.sort()).toEqual(['AMBIGUOUS', 'UNMATCHED']);
    expect(within(cards[0]!).getByText('No match')).toBeInTheDocument();
    expect(within(cards[1]!).getByText('Several matches')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Needs a decision' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      screen.getByText(/Only deposits the system couldn’t place appear here/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to payment review' })).toHaveAttribute(
      'href',
      '/admin/payments',
    );
  });

  it('shows when it arrived, how much, where from, why it was not matched, and the message as plain text', async () => {
    serveDeposits(() => [
      bankDeposit(1, {
        rawText: '<b>[신한] 입금 10,000원</b>\n홍길동  잔액 1,000원',
        reason: 'AMOUNT_MISMATCH',
      }),
      bankDeposit(2, {
        source: 'TELEGRAM',
        reason: 'STALE_MESSAGE',
        receivedAt: '2030-05-03T11:00:00.000Z',
      }),
    ]);
    renderApp('/admin/deposits');

    await screen.findAllByRole('article');
    const [first, second] = screen.getAllByRole('article') as [HTMLElement, HTMLElement];
    const one = within(first);
    expect(one.getByText('₩10,000')).toBeInTheDocument();
    expect(one.getByText('Fri, May 3, 2030 · 21:00')).toBeInTheDocument();
    expect(one.getByText('Forwarded from phone')).toBeInTheDocument();
    expect(
      one.getByText(
        'A payment code or name matched, but the amount is different from what is due.',
      ),
    ).toBeInTheDocument();
    // Markup in a message is shown as text, whitespace is kept, and the block is monospace-wrapped by CSS.
    const raw = first.querySelector('pre');
    expect(raw?.textContent).toBe('<b>[신한] 입금 10,000원</b>\n홍길동  잔액 1,000원');
    expect(raw?.querySelector('b')).toBeNull();
    expect(one.getByText('Original message')).toBeInTheDocument();

    const two = within(second);
    expect(two.getByText('Telegram')).toBeInTheDocument();
    expect(two.getByText('The message is too old to trust automatically.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(
      /AMOUNT_MISMATCH|STALE_MESSAGE|WEBHOOK|UNMATCHED/,
    );
  });

  it('explains every reason the matcher gives up', async () => {
    const reasons = [
      'AMOUNT_MISMATCH',
      'NO_CANDIDATE',
      'MULTIPLE_CANDIDATES',
      'STALE_MESSAGE',
      'RATE_GUARD',
      'STATE_CHANGED',
    ] as const satisfies readonly BankDepositReason[];
    serveDeposits(() =>
      reasons.map((reason, i) => bankDeposit(i + 1, { reason, rawText: reason })),
    );
    renderApp('/admin/deposits');

    await screen.findAllByRole('article');
    for (const article of screen.getAllByRole('article')) {
      const text = article.querySelector('.money-note')?.textContent ?? '';
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toMatch(/[A-Z]{3,}_[A-Z]+/);
    }
  });

  it('lists matched deposits with how they were matched and nothing left to do', async () => {
    serveDeposits(() => [
      bankDeposit(1, { status: 'MATCHED', reason: null, matchMethod: 'REFERENCE' }),
      bankDeposit(2, {
        status: 'MATCHED',
        reason: null,
        matchMethod: 'NAME',
        receivedAt: '2030-05-03T11:00:00.000Z',
      }),
      bankDeposit(3, {
        status: 'MATCHED',
        reason: null,
        matchMethod: 'MANUAL',
        receivedAt: '2030-05-03T10:00:00.000Z',
      }),
    ]);
    const user = userEvent.setup();
    renderApp('/admin/deposits');
    await user.click(await screen.findByRole('tab', { name: 'Matched' }));

    expect(await screen.findByText('Matched by payment code')).toBeInTheDocument();
    expect(screen.getByText('Matched by sender name')).toBeInTheDocument();
    expect(screen.getByText('Assigned by an admin')).toBeInTheDocument();
    for (const card of screen.getAllByRole('article'))
      expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    expect(api.calls.some((call) => call.url.searchParams.get('status') === 'MATCHED')).toBe(true);
  });

  it('shows an unknown amount in words and offers no action for a message that was not a deposit', async () => {
    serveDeposits(() => [
      bankDeposit(1, {
        status: 'IGNORED',
        reason: 'NOT_PARSED',
        amountKrw: null,
        rawText: 'delivery notice',
      }),
      bankDeposit(2, {
        status: 'IGNORED',
        reason: 'MANUAL',
        receivedAt: '2030-05-03T11:00:00.000Z',
      }),
    ]);
    renderApp('/admin/deposits?tab=ignored');

    await screen.findAllByRole('article');
    const [unknown, known] = screen.getAllByRole('article') as [HTMLElement, HTMLElement];
    expect(within(unknown).getByText('Unknown amount')).toBeInTheDocument();
    expect(
      within(unknown).getByText('This message doesn’t look like a deposit notice.'),
    ).toBeInTheDocument();
    expect(within(unknown).queryByRole('button')).not.toBeInTheDocument();
    // A deposit ignored by mistake can still be assigned, but not ignored again.
    expect(within(known).getByText('Ignored by an admin.')).toBeInTheDocument();
    expect(
      within(known).getByRole('button', { name: /^Assign to a registration/ }),
    ).toBeInTheDocument();
    expect(within(known).queryByRole('button', { name: /^Ignore/ })).not.toBeInTheDocument();
  });

  it('shows an empty state per tab', async () => {
    serveDeposits(() => []);
    const user = userEvent.setup();
    renderApp('/admin/deposits');
    expect(
      await screen.findByRole('heading', { name: 'Nothing needs a decision' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Ignored' }));
    expect(await screen.findByRole('heading', { name: 'No ignored deposits' })).toBeInTheDocument();
  });

  it('loads more of a long queue', async () => {
    const all = Array.from({ length: 21 }, (_, i) =>
      bankDeposit(i + 1, {
        status: 'MATCHED',
        reason: null,
        matchMethod: 'REFERENCE',
        receivedAt: new Date(Date.UTC(2030, 4, 3, 12, 0, 21 - i)).toISOString(),
      }),
    );
    serveDeposits(() => all);
    const user = userEvent.setup();
    renderApp('/admin/deposits?tab=matched');

    await screen.findAllByRole('article');
    expect(screen.getAllByRole('article')).toHaveLength(20);
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(21));
    expect(
      countCalls('GET', '/v1/admin/bank-deposits').map((call) =>
        call.url.searchParams.get('offset'),
      ),
    ).toEqual(['0', '20']);
  });

  it('explains a failure to load and tries again on request', async () => {
    let failing = true;
    api.handlers['/v1/admin/bank-deposits'] = (url) =>
      failing
        ? apiError('INTERNAL_ERROR', 500)
        : slice(
            [bankDeposit(1)].filter(() => url.searchParams.get('status') === 'UNMATCHED'),
            url,
          );
    const user = userEvent.setup();
    renderApp('/admin/deposits');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again in a moment.',
    );
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findAllByRole('article')).toHaveLength(1);
  });

  it('is only for administrators', async () => {
    signIn(api, me({ role: 'PLAYER' }));
    renderApp('/admin/deposits');
    expect(
      await screen.findByRole('heading', { name: 'You don’t have permission to do this.' }),
    ).toBeInTheDocument();
    expect(api.calls.some((call) => call.url.pathname === '/api/v1/admin/bank-deposits')).toBe(
      false,
    );
  });

  it('speaks Korean and Uzbek too', async () => {
    serveDeposits(() => [bankDeposit(1)]);
    chooseLanguageAndRegion('ko', 'all');
    signIn(api, me({ role: 'ADMIN', preferredLanguage: 'ko', effectiveLanguage: 'ko' }));
    const { unmount } = renderApp('/admin/deposits');
    expect(await screen.findByRole('heading', { level: 1, name: '입금 내역' })).toBeInTheDocument();
    expect(
      await screen.findByText(
        '일치하는 입금 대기 건이 없습니다. 입금 코드나 등록된 입금자명을 찾지 못했어요.',
      ),
    ).toBeInTheDocument();
    unmount();

    chooseLanguageAndRegion('uz', 'all');
    signIn(api, me({ role: 'ADMIN', preferredLanguage: 'uz', effectiveLanguage: 'uz' }));
    renderApp('/admin/deposits');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Kelgan pul o‘tkazmalari' }),
    ).toBeInTheDocument();
  });
});

describe('bank deposits: assigning', () => {
  const awaiting = (n: number, name: string, amountKrw = 10000, extra: PaymentOptions = {}) =>
    adminPayment(n, {
      name,
      amountKrw,
      status: 'AWAITING_PAYMENT',
      hasReceipt: false,
      receiptUploadedAt: null,
      referenceCode: `10${n}`,
      ...extra,
    });

  const openAssign = async (user: ReturnType<typeof userEvent.setup>) => {
    const [newest] = await screen.findAllByRole('button', { name: /^Assign to a registration/ });
    await user.click(newest!);
    return dialogOf('Assign deposit');
  };

  beforeEach(() => {
    servePayments(() => [
      awaiting(1, 'Aziz Karimov'),
      awaiting(2, 'Dilnoza Rakhimova', 12000),
      awaiting(3, 'Cancelled Carl', 10000, { registrationStatus: 'CANCELLED' }),
      adminPayment(4, { name: 'Bekzod Aliev', status: 'PAYMENT_REVIEW', referenceCode: '4410' }),
    ]);
  });

  it('lists the registrations waiting for exactly that amount, from both waiting queues', async () => {
    serveDeposits(() => [bankDeposit(1)]);
    const user = userEvent.setup();
    renderApp('/admin/deposits');
    const dialog = await openAssign(user);

    expect(await dialog.findByRole('button', { name: /Aziz Karimov/ })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: /Bekzod Aliev/ })).toBeInTheDocument();
    expect(dialog.queryByText('Dilnoza Rakhimova')).not.toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Same amount only (₩10,000)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // The deposit being assigned stays in view, message included.
    expect(dialog.getByText('Original message')).toBeInTheDocument();
    expect(dialog.getByText('[신한] 05/03 21:00 입금 10,000원 홍길동 #1')).toBeInTheDocument();

    const statuses = countCalls('GET', '/v1/admin/payments')
      .filter((call) => call.url.searchParams.get('limit') === '100')
      .map((call) => call.url.searchParams.get('status'));
    expect(statuses.sort()).toEqual(['AWAITING_PAYMENT', 'PAYMENT_REVIEW']);
  });

  it('puts live registrations before cancelled ones, each showing its state, match, time, amount and code', async () => {
    serveDeposits(() => [bankDeposit(1)]);
    const user = userEvent.setup();
    renderApp('/admin/deposits');
    const dialog = await openAssign(user);
    await dialog.findByRole('button', { name: /Aziz Karimov/ });

    const rows = dialog
      .getAllByRole('button')
      .filter((button) => button.classList.contains('money-candidate'));
    expect(rows.map((row) => row.querySelector('strong')?.textContent)).toEqual([
      'Aziz Karimov',
      'Bekzod Aliev',
      'Cancelled Carl',
    ]);
    const aziz = within(rows[0]!);
    expect(aziz.getByText('Awaiting payment')).toBeInTheDocument();
    expect(aziz.getByText('Gangnam Friday futsal')).toBeInTheDocument();
    expect(aziz.getByText('Sat, May 4, 2030 · 22:00')).toBeInTheDocument();
    expect(aziz.getByText('₩10,000')).toBeInTheDocument();
    expect(aziz.getByText('101')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Checking payment')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Cancelled')).toBeInTheDocument();
  });

  it('can show every amount, but only registrations owing exactly the deposit can be chosen', async () => {
    serveDeposits(() => [bankDeposit(1)]);
    const user = userEvent.setup();
    renderApp('/admin/deposits');
    const dialog = await openAssign(user);
    await dialog.findByRole('button', { name: /Aziz Karimov/ });

    await user.click(dialog.getByRole('button', { name: 'Same amount only (₩10,000)' }));

    const other = await dialog.findByRole('button', { name: /Dilnoza Rakhimova/ });
    expect(other).toBeDisabled();
    expect(
      within(other).getByText('The amount differs from the deposit, so it can’t be assigned.'),
    ).toBeInTheDocument();
    expect(within(other).getByText('₩12,000')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: /Aziz Karimov/ })).toBeEnabled();
  });

  it('searches by name or payment code, ignoring case', async () => {
    serveDeposits(() => [bankDeposit(1)]);
    const user = userEvent.setup();
    renderApp('/admin/deposits');
    const dialog = await openAssign(user);
    await dialog.findByRole('button', { name: /Aziz Karimov/ });

    await user.type(
      dialog.getByRole('searchbox', { name: 'Search by name or payment code' }),
      'BEKZ',
    );
    expect(dialog.getByRole('button', { name: /Bekzod Aliev/ })).toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: /Aziz Karimov/ })).not.toBeInTheDocument();

    await user.clear(dialog.getByRole('searchbox'));
    await user.type(dialog.getByRole('searchbox'), '101');
    expect(dialog.getByRole('button', { name: /Aziz Karimov/ })).toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: /Bekzod Aliev/ })).not.toBeInTheDocument();

    await user.clear(dialog.getByRole('searchbox'));
    await user.type(dialog.getByRole('searchbox'), 'nobody');
    expect(
      await dialog.findByRole('heading', { name: 'No registrations match your search' }),
    ).toBeInTheDocument();
  });

  it('offers to widen the search when nobody owes that amount', async () => {
    serveDeposits(() => [bankDeposit(1, { amountKrw: 7000 })]);
    const user = userEvent.setup();
    renderApp('/admin/deposits');
    const dialog = await openAssign(user);

    expect(
      await dialog.findByRole('heading', { name: 'No registration is waiting to pay ₩7,000' }),
    ).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Show all amounts' }));
    expect(await dialog.findByText('Aziz Karimov')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: /Aziz Karimov/ })).toBeDisabled();
  });

  it('asks before assigning, can step back keeping the search, then assigns and folds the card away', async () => {
    let deposits = [
      bankDeposit(1),
      bankDeposit(2, { receivedAt: '2030-05-03T11:00:00.000Z', rawText: 'second deposit' }),
    ];
    serveDeposits(() => deposits);
    api.handlers[depositPath(1, 'assign')] = () => {
      deposits = deposits.filter((deposit) => deposit.id !== uuid(3001));
      return json({});
    };
    const user = userEvent.setup();
    renderApp('/admin/deposits');
    const dialog = await openAssign(user);

    await user.type(await dialog.findByRole('searchbox'), 'aziz');
    await user.click(await dialog.findByRole('button', { name: /Aziz Karimov/ }));

    expect(dialog.getByRole('heading', { name: 'Assign this deposit?' })).toBeInTheDocument();
    expect(
      dialog.getByText('This confirms Aziz Karimov’s payment and notifies them.'),
    ).toBeInTheDocument();
    expect(dialog.getByText('₩10,000')).toBeInTheDocument();
    expect(api.find('POST', depositPath(1, 'assign'))).toBeUndefined();

    await user.click(dialog.getByRole('button', { name: 'Back' }));
    expect(dialog.getByRole('searchbox')).toHaveValue('aziz');
    await user.click(dialog.getByRole('button', { name: /Aziz Karimov/ }));
    await user.click(dialog.getByRole('button', { name: 'Assign and confirm payment' }));

    expect(await screen.findByText('Deposit assigned to Aziz Karimov')).toBeInTheDocument();
    expect(bodyOf(api.find('POST', depositPath(1, 'assign')))).toEqual({ registrationId: uuid(1) });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Assign deposit' })).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.queryByText('[신한] 05/03 21:00 입금 10,000원 홍길동 #1'),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText('second deposit')).toBeInTheDocument();
  });

  it('shows a failure in the sheet and stays on the confirmation', async () => {
    serveDeposits(() => [bankDeposit(1)]);
    api.handlers[depositPath(1, 'assign')] = () => apiError('INTERNAL_ERROR', 500);
    const user = userEvent.setup();
    renderApp('/admin/deposits');
    const dialog = await openAssign(user);
    await user.click(await dialog.findByRole('button', { name: /Aziz Karimov/ }));
    await user.click(dialog.getByRole('button', { name: 'Assign and confirm payment' }));

    expect(await dialog.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again in a moment.',
    );
    expect(dialog.getByRole('button', { name: 'Assign and confirm payment' })).toBeEnabled();
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  it('says so and refreshes when the deposit or payment changed in the meantime', async () => {
    let deposits = [bankDeposit(1)];
    serveDeposits(() => deposits);
    api.handlers[depositPath(1, 'assign')] = () => {
      deposits = [];
      return apiError('INVALID_STATE', 409);
    };
    const user = userEvent.setup();
    renderApp('/admin/deposits');
    const dialog = await openAssign(user);
    await user.click(await dialog.findByRole('button', { name: /Aziz Karimov/ }));
    await user.click(dialog.getByRole('button', { name: 'Assign and confirm payment' }));

    expect(await screen.findByText('This action isn’t available right now.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Assign deposit' })).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByRole('heading', { name: 'Nothing needs a decision' }),
    ).toBeInTheDocument();
  });

  it('explains a failure to load the registrations and tries again on request', async () => {
    serveDeposits(() => [bankDeposit(1)]);
    let failing = true;
    api.handlers['/v1/admin/payments'] = (url) =>
      failing
        ? apiError('INTERNAL_ERROR', 500)
        : slice(
            [awaiting(1, 'Aziz Karimov')].filter(
              () => url.searchParams.get('status') === 'AWAITING_PAYMENT',
            ),
            url,
          );
    const user = userEvent.setup();
    renderApp('/admin/deposits');
    const dialog = await openAssign(user);

    expect(await dialog.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again in a moment.',
    );
    failing = false;
    await user.click(dialog.getByRole('button', { name: 'Try again' }));
    expect(await dialog.findByRole('button', { name: /Aziz Karimov/ })).toBeInTheDocument();
  });

  it('reads long queues page by page and warns when they are too long to read fully', async () => {
    serveDeposits(() => [bankDeposit(1)]);
    const many = Array.from({ length: 1000 }, (_, i) => awaiting(i + 1, `Player ${i + 1}`));
    api.handlers['/v1/admin/payments'] = (url) =>
      url.searchParams.get('status') === 'AWAITING_PAYMENT' ? slice(many, url) : slice([], url);
    const user = userEvent.setup();
    renderApp('/admin/deposits');
    const dialog = await openAssign(user);

    expect(
      await dialog.findByText('This list is very long, so some registrations may be missing.'),
    ).toBeInTheDocument();
    const offsets = api.calls
      .filter(
        (call) =>
          call.url.pathname === '/api/v1/admin/payments' &&
          call.url.searchParams.get('status') === 'AWAITING_PAYMENT',
      )
      .map((call) => Number(call.url.searchParams.get('offset')));
    expect(offsets).toEqual(Array.from({ length: 10 }, (_, i) => i * 100));
    // Rows are capped so the sheet stays fast; searching narrows the rest.
    expect(
      dialog
        .getAllByRole('button')
        .filter((button) => button.classList.contains('money-candidate')),
    ).toHaveLength(50);
    expect(dialog.getByText('Showing 50 of 1000. Search to narrow the list.')).toBeInTheDocument();
  });

  it('reads a queue that fits in two pages completely, without a warning', async () => {
    serveDeposits(() => [bankDeposit(1)]);
    const many = Array.from({ length: 130 }, (_, i) => awaiting(i + 1, `Player ${i + 1}`));
    api.handlers['/v1/admin/payments'] = (url) =>
      url.searchParams.get('status') === 'AWAITING_PAYMENT' ? slice(many, url) : slice([], url);
    const user = userEvent.setup();
    renderApp('/admin/deposits');
    const dialog = await openAssign(user);

    await dialog.findByText('Showing 50 of 130. Search to narrow the list.');
    expect(
      dialog.queryByText('This list is very long, so some registrations may be missing.'),
    ).not.toBeInTheDocument();
  });

  it('is not offered for a deposit whose amount is unknown', async () => {
    serveDeposits(() => [
      bankDeposit(1, { amountKrw: null, status: 'UNMATCHED', reason: 'NO_CANDIDATE' }),
    ]);
    renderApp('/admin/deposits');

    const card = within(await screen.findByRole('article'));
    expect(
      card.queryByRole('button', { name: /^Assign to a registration/ }),
    ).not.toBeInTheDocument();
    expect(card.getByRole('button', { name: /^Ignore/ })).toBeInTheDocument();
  });
});

describe('bank deposits: ignoring', () => {
  it('explains what ignoring means, then ignores and folds the card away', async () => {
    let deposits = [
      bankDeposit(1),
      bankDeposit(2, { receivedAt: '2030-05-03T11:00:00.000Z', rawText: 'keep me' }),
    ];
    serveDeposits(() => deposits);
    api.handlers[depositPath(1, 'ignore')] = () => {
      deposits = deposits.filter((deposit) => deposit.id !== uuid(3001));
      return json({});
    };
    const user = userEvent.setup();
    renderApp('/admin/deposits');

    const [firstIgnore] = await screen.findAllByRole('button', { name: /^Ignore/ });
    await user.click(firstIgnore!);
    const dialog = await dialogOf('Ignore this deposit?');
    expect(
      dialog.getByText(/It won’t be matched again and moves to the Ignored tab/),
    ).toBeInTheDocument();
    expect(dialog.getByText('₩10,000')).toBeInTheDocument();
    expect(dialog.getByText('[신한] 05/03 21:00 입금 10,000원 홍길동 #1')).toBeInTheDocument();
    expect(api.find('POST', depositPath(1, 'ignore'))).toBeUndefined();

    await user.click(dialog.getByRole('button', { name: 'Ignore deposit' }));

    expect(await screen.findByText('Deposit ignored')).toBeInTheDocument();
    expect(api.find('POST', depositPath(1, 'ignore'))).toBeDefined();
    await waitFor(() =>
      expect(
        screen.queryByText('[신한] 05/03 21:00 입금 10,000원 홍길동 #1'),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText('keep me')).toBeInTheDocument();
  });

  it('does nothing when the admin backs out', async () => {
    serveDeposits(() => [bankDeposit(1)]);
    const user = userEvent.setup();
    renderApp('/admin/deposits');
    await user.click(await screen.findByRole('button', { name: /^Ignore/ }));
    await user.click(
      (await dialogOf('Ignore this deposit?')).getByRole('button', { name: 'Cancel' }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Ignore this deposit?' }),
      ).not.toBeInTheDocument(),
    );
    expect(api.calls.some((call) => call.init?.method === 'POST')).toBe(false);
  });

  it('shows a failure in the sheet and allows another try', async () => {
    serveDeposits(() => [bankDeposit(1)]);
    api.handlers[depositPath(1, 'ignore')] = () => apiError('INTERNAL_ERROR', 500);
    const user = userEvent.setup();
    renderApp('/admin/deposits');
    await user.click(await screen.findByRole('button', { name: /^Ignore/ }));
    const dialog = await dialogOf('Ignore this deposit?');
    await user.click(dialog.getByRole('button', { name: 'Ignore deposit' }));

    expect(await dialog.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again in a moment.',
    );
    expect(dialog.getByRole('button', { name: 'Ignore deposit' })).toBeEnabled();
  });

  it('says so and refreshes when someone else already decided', async () => {
    let deposits = [bankDeposit(1)];
    serveDeposits(() => deposits);
    api.handlers[depositPath(1, 'ignore')] = () => {
      deposits = [];
      return apiError('INVALID_STATE', 409);
    };
    const user = userEvent.setup();
    renderApp('/admin/deposits');
    await user.click(await screen.findByRole('button', { name: /^Ignore/ }));
    await user.click(
      (await dialogOf('Ignore this deposit?')).getByRole('button', { name: 'Ignore deposit' }),
    );

    expect(await screen.findByText('This action isn’t available right now.')).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Nothing needs a decision' }),
    ).toBeInTheDocument();
  });
});

// ================================================================================================
// Shared behavior
// ================================================================================================

describe('resolving an item', () => {
  const wrapper = (client: QueryClient) =>
    function Wrapper({ children }: { readonly children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    };

  const seed = (client: QueryClient) => {
    client.setQueryData(['admin-payments', 'list', 'x'], 1);
    client.setQueryData(['admin-deposits', 'list', 'y'], 1);
    client.setQueryData(['unrelated'], 1);
  };
  const invalidated = (client: QueryClient, key: readonly unknown[]) =>
    client.getQueryState(key)?.isInvalidated;

  it('folds the item away first and refreshes every queue after the animation', async () => {
    const client = new QueryClient();
    seed(client);
    const queues = [['admin-deposits'], ['admin-payments']];
    const { result } = renderHook(() => useResolution(queues), { wrapper: wrapper(client) });

    expect(result.current.isLeaving('a')).toBe(false);
    act(() => result.current.leave('a'));
    expect(result.current.isLeaving('a')).toBe(true);
    expect(result.current.isLeaving('b')).toBe(false);
    expect(invalidated(client, ['admin-payments', 'list', 'x'])).toBe(false);

    await waitFor(() => expect(invalidated(client, ['admin-payments', 'list', 'x'])).toBe(true), {
      timeout: EXIT_MS + 1000,
    });
    expect(invalidated(client, ['admin-deposits', 'list', 'y'])).toBe(true);
    expect(invalidated(client, ['unrelated'])).toBe(false);
  });

  it('refreshes at once when the screen is left mid-animation, so the next visit is current', () => {
    const client = new QueryClient();
    seed(client);
    const { result, unmount } = renderHook(() => useResolution([['admin-payments']]), {
      wrapper: wrapper(client),
    });
    act(() => result.current.leave('a'));
    expect(invalidated(client, ['admin-payments', 'list', 'x'])).toBe(false);

    unmount();

    expect(invalidated(client, ['admin-payments', 'list', 'x'])).toBe(true);
  });

  it('does not refresh on unmount when nothing was resolved', () => {
    const client = new QueryClient();
    seed(client);
    const { unmount } = renderHook(() => useResolution([['admin-payments']]), {
      wrapper: wrapper(client),
    });
    unmount();
    expect(invalidated(client, ['admin-payments', 'list', 'x'])).toBe(false);
  });

  it('refreshes on demand', () => {
    const client = new QueryClient();
    seed(client);
    const { result } = renderHook(() => useResolution([['admin-payments']]), {
      wrapper: wrapper(client),
    });
    act(() => result.current.refresh());
    expect(invalidated(client, ['admin-payments', 'list', 'x'])).toBe(true);
  });
});

describe('candidate filter', () => {
  const candidate = (n: number, name: string, options: PaymentOptions = {}) =>
    adminPayment(n, { name, status: 'AWAITING_PAYMENT', ...options });
  const names = (items: readonly { user: { displayName: string } }[]) =>
    items.map((item) => item.user.displayName);

  it('keeps only the exact amount when asked, and everything otherwise', () => {
    const items = [candidate(1, 'A'), candidate(2, 'B', { amountKrw: 12000 })];
    expect(
      names(filterCandidates(items, { amountKrw: 10000, sameAmountOnly: true, query: '' })),
    ).toEqual(['A']);
    expect(
      names(filterCandidates(items, { amountKrw: 10000, sameAmountOnly: false, query: '' })),
    ).toEqual(['A', 'B']);
    expect(filterCandidates(items, { amountKrw: null, sameAmountOnly: true, query: '' })).toEqual(
      [],
    );
  });

  it('matches names regardless of case, spacing and Unicode form, and payment codes', () => {
    const items = [
      candidate(1, 'Aziz Karimov', { referenceCode: '1234' }),
      candidate(2, '김풋볼', { referenceCode: null }),
    ];
    const filter = (query: string) =>
      names(filterCandidates(items, { amountKrw: 10000, sameAmountOnly: true, query }));
    expect(filter('  AZIZ ')).toEqual(['Aziz Karimov']);
    expect(filter('1234')).toEqual(['Aziz Karimov']);
    // A name typed on a keyboard that emits decomposed Hangul still finds the composed name.
    expect(filter('김풋볼'.normalize('NFD'))).toEqual(['김풋볼']);
    expect(filter('zzz')).toEqual([]);
  });

  it('sorts live registrations first, then the most recently due, without touching the input', () => {
    const items = [
      candidate(1, 'old', { registrationStatus: 'CANCELLED' }),
      candidate(2, 'live-early'),
      candidate(3, 'live-late'),
    ].map((item, i) => ({
      ...item,
      payment: { ...item.payment, dueAt: `2030-05-0${i + 1}T00:00:00.000Z` },
    }));
    const original = [...items];

    expect(
      names(filterCandidates(items, { amountKrw: 10000, sameAmountOnly: true, query: '' })),
    ).toEqual(['live-late', 'live-early', 'old']);
    expect(items).toEqual(original);
  });
});

describe('merging deposit queues', () => {
  const deposit = (id: string, receivedAt: string) => ({ ...bankDeposit(1), id, receivedAt });
  const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);
  const page = (items: ReturnType<typeof deposit>[]) => ({ items, limit: 3, offset: 0 });

  it('interleaves the queues by time, newest first', () => {
    const slice = mergeDepositPages(
      [
        page([deposit('a1', '2030-01-05T00:00:00Z'), deposit('a2', '2030-01-01T00:00:00Z')]),
        page([deposit('b1', '2030-01-04T00:00:00Z'), deposit('b2', '2030-01-02T00:00:00Z')]),
      ],
      [0, 0],
      10,
    );
    expect(ids(slice.items)).toEqual(['a1', 'b1', 'b2', 'a2']);
    expect(slice.next).toBeNull();
  });

  it('continues from what was actually shown, so the next page cannot skip or repeat anything', () => {
    const first = mergeDepositPages(
      [
        page([
          deposit('a1', '2030-01-09T00:00:00Z'),
          deposit('a2', '2030-01-08T00:00:00Z'),
          deposit('a3', '2030-01-07T00:00:00Z'),
        ]),
        page([
          deposit('b1', '2030-01-06T00:00:00Z'),
          deposit('b2', '2030-01-05T00:00:00Z'),
          deposit('b3', '2030-01-04T00:00:00Z'),
        ]),
      ],
      [0, 0],
      3,
    );
    // Only A's items were shown; B's first page is read again, not lost.
    expect(ids(first.items)).toEqual(['a1', 'a2', 'a3']);
    expect(first.next).toEqual([3, 0]);
  });

  it('counts shown items per queue when they interleave', () => {
    const slice = mergeDepositPages(
      [
        page([
          deposit('a1', '2030-01-09T00:00:00Z'),
          deposit('a2', '2030-01-05T00:00:00Z'),
          deposit('a3', '2030-01-01T00:00:00Z'),
        ]),
        page([
          deposit('b1', '2030-01-08T00:00:00Z'),
          deposit('b2', '2030-01-07T00:00:00Z'),
          deposit('b3', '2030-01-06T00:00:00Z'),
        ]),
      ],
      [20, 40],
      3,
    );
    expect(ids(slice.items)).toEqual(['a1', 'b1', 'b2']);
    expect(slice.next).toEqual([21, 42]);
  });

  it('keeps going while a queue returned a full page, and stops when all are short', () => {
    expect(
      mergeDepositPages(
        [
          page([
            deposit('a1', '2030-01-03T00:00:00Z'),
            deposit('a2', '2030-01-02T00:00:00Z'),
            deposit('a3', '2030-01-01T00:00:00Z'),
          ]),
        ],
        [0],
        3,
      ).next,
    ).toEqual([3]);
    expect(
      mergeDepositPages([page([deposit('a1', '2030-01-03T00:00:00Z')])], [0], 3).next,
    ).toBeNull();
    expect(mergeDepositPages([page([]), page([])], [0, 0], 3)).toEqual({ items: [], next: null });
  });

  it('orders deposits received at the same instant by id, like the API', () => {
    const slice = mergeDepositPages(
      [page([deposit('b', '2030-01-01T00:00:00Z')]), page([deposit('c', '2030-01-01T00:00:00Z')])],
      [0, 0],
      5,
    );
    expect(ids(slice.items)).toEqual(['c', 'b']);
  });
});
