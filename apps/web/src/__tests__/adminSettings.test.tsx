import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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
  type Call,
} from '../test-utils';

let api: Api;
beforeEach(() => {
  api = mockApi();
  setDeviceLanguages(['en-US']);
  chooseLanguageAndRegion('en', 'all');
  signIn(api, me({ role: 'ADMIN' }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const bodyOf = (call: Call | undefined): unknown => JSON.parse(String(call?.init?.body));
const calls = (method: string, path: string) =>
  api.calls.filter((c) => (c.init?.method ?? 'GET') === method && c.url.pathname === `/api${path}`);

// ---- Payment instructions ---------------------------------------------------------------------

const PAYMENT = '/v1/admin/payment-instructions/current';
const PAYMENT_SAVE = '/v1/admin/payment-instructions';

const KOREAN = { bankName: '신한은행', instructions: '입금 코드를 보내는 사람 메모에 적어주세요.' };
const UZBEK = { bankName: 'Shinhan Bank', instructions: 'To‘lov kodini izohga yozing.' };

function activeInstruction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    accountNumber: '110-123-456789',
    accountHolder: 'FOODBOLL FC',
    translations: { ko: KOREAN, uz: UZBEK },
    missingLanguages: ['en'],
    ...overrides,
  };
}

/** An in-memory store: the page reads what a save wrote. */
function servePayment(initial: ReturnType<typeof activeInstruction> | null) {
  let stored = initial;
  api.handlers[PAYMENT] = () =>
    stored ? json(stored) : apiError('PAYMENT_INSTRUCTIONS_NOT_FOUND', 404);
  api.handlers[PAYMENT_SAVE] = (_url, init) => {
    const input = JSON.parse(String(init?.body)) as Record<string, unknown>;
    stored = activeInstruction({ ...input, id: 'p2', missingLanguages: [] });
    return json(stored);
  };
}

const openPreview = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Review and save' }));
  return within(await screen.findByRole('dialog', { name: 'Check before saving' }));
};

describe('payment instructions: what is shown', () => {
  it('starts from an empty form, and says players cannot pay yet, when nothing was ever saved', async () => {
    servePayment(null);
    renderApp('/admin/payment-info');

    expect(await screen.findByText('No payment instructions yet')).toBeInTheDocument();
    expect(screen.getByText(/can’t see where to send their payment/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'What players see now' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Account number')).toHaveValue('');
    expect(screen.getByLabelText('Account holder')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Review and save' })).toBeEnabled();
  });

  it('shows the card players see now, in the admin language with the Korean fallback, and who gets it', async () => {
    servePayment(activeInstruction());
    renderApp('/admin/payment-info');

    const summary = await screen.findByRole('region', { name: 'What players see now' });
    const card = within(summary);
    expect(card.getByText('신한은행')).toHaveAttribute('lang', 'ko');
    expect(card.getByText('110-123-456789')).toBeInTheDocument();
    expect(card.getByText('FOODBOLL FC')).toBeInTheDocument();
    expect(card.getByText(KOREAN.instructions)).toBeInTheDocument();
    expect(card.getByText('This is how players who read English see it.')).toBeInTheDocument();
    // `missingLanguages` of the API: English readers get Korean right now.
    expect(
      card.getByText(
        'Right now there is no text in English. When a language has no text, players who read it see the Korean text.',
      ),
    ).toBeInTheDocument();
  });

  it('prefills the form from the active instructions and marks the empty language tab', async () => {
    servePayment(activeInstruction());
    const user = userEvent.setup();
    renderApp('/admin/payment-info');

    expect(await screen.findByLabelText('Account number')).toHaveValue('110-123-456789');
    expect(screen.getByLabelText('Account holder')).toHaveValue('FOODBOLL FC');
    expect(screen.getByLabelText('Bank')).toHaveValue('신한은행');
    expect(screen.getByRole('tab', { name: '한국어 Written' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'O‘zbekcha Written' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'English Empty' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'There is no text yet in English. When a language has no text, people who read it see the Korean text.',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'O‘zbekcha Written' }));
    expect(screen.getByLabelText('Bank')).toHaveValue('Shinhan Bank');
    expect(screen.getByLabelText('Instructions')).toHaveValue(UZBEK.instructions);
  });

  it('moves between the language tabs with the arrow keys, one tab stop for the whole group', async () => {
    servePayment(activeInstruction());
    const user = userEvent.setup();
    renderApp('/admin/payment-info');

    const korean = await screen.findByRole('tab', { name: '한국어 Written' });
    expect(korean).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'O‘zbekcha Written' })).toHaveAttribute(
      'tabindex',
      '-1',
    );

    korean.focus();
    await user.keyboard('{ArrowRight}');
    const uzbek = screen.getByRole('tab', { name: 'O‘zbekcha Written' });
    expect(uzbek).toHaveAttribute('aria-selected', 'true');
    expect(uzbek).toHaveFocus();
    expect(screen.getByLabelText('Bank')).toHaveValue('Shinhan Bank');

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'English Empty' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: '한국어 Written' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'English Empty' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tabpanel')).toContainElement(screen.getByLabelText('Bank'));
  });

  it('shows the page in the language of the admin', async () => {
    signIn(api, me({ role: 'ADMIN', preferredLanguage: 'ko', effectiveLanguage: 'ko' }));
    chooseLanguageAndRegion('ko', 'all');
    servePayment(activeInstruction());
    renderApp('/admin/payment-info');

    expect(await screen.findByRole('heading', { level: 1, name: '결제 안내' })).toBeInTheDocument();
    expect(
      await screen.findByRole('region', { name: '지금 선수에게 보이는 안내' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '확인하고 저장' })).toBeDisabled();
  });

  it('explains a failed load in the admin language and loads again on retry', async () => {
    api.handlers[PAYMENT] = () => apiError('INTERNAL_ERROR', 500);
    const user = userEvent.setup();
    renderApp('/admin/payment-info');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again in a moment.',
    );
    servePayment(activeInstruction());
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Account number')).toHaveValue('110-123-456789');
  });

  it('is not offered to anyone but admins', async () => {
    signIn(api, me({ role: 'ORGANIZER' }));
    servePayment(activeInstruction());
    renderApp('/admin/payment-info');

    expect(await screen.findByText('You don’t have permission to do this.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Account number')).not.toBeInTheDocument();
    expect(calls('GET', PAYMENT)).toHaveLength(0);
  });
});

describe('payment instructions: saving', () => {
  it('previews the card exactly as players see it, warns about the account, and only then saves', async () => {
    servePayment(activeInstruction());
    const user = userEvent.setup();
    renderApp('/admin/payment-info');

    const number = await screen.findByLabelText('Account number');
    await user.clear(number);
    await user.type(number, '110-999-000111');
    const dialog = await openPreview(user);

    const card = dialog.getByRole('region', { name: 'Bank account' });
    expect(within(card).getByText('신한은행')).toBeInTheDocument();
    expect(within(card).getByText('110-999-000111')).toBeInTheDocument();
    expect(within(card).getByText('FOODBOLL FC')).toBeInTheDocument();
    expect(within(card).getByText(KOREAN.instructions)).toBeInTheDocument();
    expect(
      dialog.getByText('The account number changes: 110-123-456789 → 110-999-000111'),
    ).toBeInTheDocument();
    expect(
      dialog.getByText(
        /Players will send real money to this account\. Check the account number and holder name character by character/,
      ),
    ).toBeInTheDocument();
    expect(dialog.queryByText(/The account holder changes/)).not.toBeInTheDocument();
    // Looking is not saving.
    expect(api.find('PUT', PAYMENT_SAVE)).toBeUndefined();

    await user.click(dialog.getByRole('button', { name: 'Save and apply' }));

    await waitFor(() => expect(api.find('PUT', PAYMENT_SAVE)).toBeDefined());
    expect(bodyOf(api.find('PUT', PAYMENT_SAVE))).toEqual({
      accountNumber: '110-999-000111',
      accountHolder: 'FOODBOLL FC',
      translations: { ko: KOREAN, uz: UZBEK },
    });
    expect(await screen.findByText('Payment instructions saved')).toBeInTheDocument();
    // Refetched: the summary now shows the saved account and the dialog is gone.
    const summary = await screen.findByRole('region', { name: 'What players see now' });
    expect(within(summary).getByText('110-999-000111')).toBeInTheDocument();
    expect(calls('GET', PAYMENT).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('dialog', { name: 'Check before saving' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review and save' })).toBeDisabled();
  });

  it('lets the admin check every language in the preview, saying when readers get Korean instead', async () => {
    servePayment(activeInstruction());
    const user = userEvent.setup();
    renderApp('/admin/payment-info');

    await screen.findByLabelText('Account number');
    await user.type(screen.getByLabelText('Account holder'), ' 2');
    const dialog = await openPreview(user);
    expect(dialog.getByRole('tab', { name: '한국어', selected: true })).toBeInTheDocument();
    expect(
      dialog.getByText('The account holder changes: FOODBOLL FC → FOODBOLL FC 2'),
    ).toBeInTheDocument();

    await user.click(dialog.getByRole('tab', { name: 'O‘zbekcha' }));
    expect(dialog.getByText('Shinhan Bank')).toHaveAttribute('lang', 'uz');
    expect(dialog.getByText(UZBEK.instructions)).toBeInTheDocument();
    expect(dialog.queryByText(/so players see the Korean text/)).not.toBeInTheDocument();

    await user.click(dialog.getByRole('tab', { name: 'English' }));
    expect(dialog.getByText('신한은행')).toHaveAttribute('lang', 'ko');
    expect(
      dialog.getByText('There is no English text, so players see the Korean text.'),
    ).toBeInTheDocument();
  });

  it('sends only the languages that were written, trimmed, and keeps the account as typed', async () => {
    servePayment(null);
    const user = userEvent.setup();
    renderApp('/admin/payment-info');

    await user.type(await screen.findByLabelText('Account number'), ' 110-123-456789 ');
    await user.type(screen.getByLabelText('Account holder'), 'FOODBOLL FC');
    await user.type(screen.getByLabelText('Bank'), '  신한은행 ');
    await user.type(screen.getByLabelText('Instructions'), KOREAN.instructions);
    await user.click(screen.getByRole('tab', { name: 'English Empty' }));
    await user.type(screen.getByLabelText('Bank'), 'Shinhan Bank');
    await user.type(screen.getByLabelText('Instructions'), 'Use your payment code.');

    const dialog = await openPreview(user);
    // A first save has nothing to compare with.
    expect(dialog.queryByText(/The account number changes/)).not.toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Save and apply' }));

    await waitFor(() => expect(api.find('PUT', PAYMENT_SAVE)).toBeDefined());
    expect(bodyOf(api.find('PUT', PAYMENT_SAVE))).toEqual({
      accountNumber: '110-123-456789',
      accountHolder: 'FOODBOLL FC',
      translations: {
        ko: KOREAN,
        en: { bankName: 'Shinhan Bank', instructions: 'Use your payment code.' },
      },
    });
  });

  it('counts what is left of each limit, the way the API counts', async () => {
    servePayment(null);
    const user = userEvent.setup();
    renderApp('/admin/payment-info');

    expect(await screen.findByText('100 characters left')).toBeInTheDocument();
    expect(screen.getByText('2,000 characters left')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Bank'), '  abc  ');
    expect(screen.getByText('97 characters left')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Instructions'), {
      target: { value: 'x'.repeat(2003) },
    });
    expect(screen.getByText('3 characters over')).toBeInTheDocument();
  });

  it('keeps the bank details in the open until the admin confirms, and nothing is sent when the preview is dismissed', async () => {
    servePayment(activeInstruction());
    const user = userEvent.setup();
    renderApp('/admin/payment-info');

    await user.type(await screen.findByLabelText('Account holder'), ' 2');
    const dialog = await openPreview(user);
    await user.click(dialog.getByRole('button', { name: 'Keep editing' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Check before saving' })).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Account holder')).toHaveValue('FOODBOLL FC 2');
    expect(api.find('PUT', PAYMENT_SAVE)).toBeUndefined();
  });

  it('does not offer a save while nothing has changed', async () => {
    servePayment(activeInstruction());
    const user = userEvent.setup();
    renderApp('/admin/payment-info');

    const save = await screen.findByRole('button', { name: 'Review and save' });
    expect(save).toBeDisabled();
    expect(screen.getByText('Nothing has changed.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Account holder'), '!');
    expect(save).toBeEnabled();
    expect(screen.queryByText('Nothing has changed.')).not.toBeInTheDocument();
  });

  it('shows what the admin typed as text, never as markup', async () => {
    servePayment(activeInstruction());
    const user = userEvent.setup();
    const { container } = renderApp('/admin/payment-info');

    const instructions = await screen.findByLabelText('Instructions');
    fireEvent.change(instructions, {
      target: { value: '<img src=x onerror="alert(1)"> <b>pay here</b>' },
    });
    const dialog = await openPreview(user);

    expect(dialog.getByText('<img src=x onerror="alert(1)"> <b>pay here</b>')).toBeInTheDocument();
    expect(container.querySelector('img, b')).toBeNull();
    expect(document.querySelector('dialog img, dialog b')).toBeNull();
  });
});

describe('payment instructions: validation', () => {
  it('reports every missing field in the admin language, focuses the first and opens no preview', async () => {
    servePayment(null);
    const user = userEvent.setup();
    renderApp('/admin/payment-info');

    await user.click(await screen.findByRole('button', { name: 'Review and save' }));

    expect(screen.getByLabelText('Account number')).toHaveAccessibleDescription(
      'This field is required.',
    );
    expect(screen.getByLabelText('Account holder')).toHaveAccessibleDescription(
      'This field is required.',
    );
    expect(screen.getByLabelText('Bank')).toHaveAccessibleDescription(
      expect.stringContaining('This field is required.'),
    );
    expect(screen.getByLabelText('Instructions')).toHaveAccessibleDescription(
      expect.stringContaining('This field is required.'),
    );
    expect(screen.getByLabelText('Account number')).toHaveFocus();
    expect(screen.getByRole('tab', { name: '한국어 Needs attention' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Check before saving' })).not.toBeInTheDocument();
    expect(api.find('PUT', PAYMENT_SAVE)).toBeUndefined();
  });

  it('checks the account number format while typing, once the first attempt was made', async () => {
    servePayment(activeInstruction());
    const user = userEvent.setup();
    renderApp('/admin/payment-info');

    const number = await screen.findByLabelText('Account number');
    await user.clear(number);
    await user.type(number, 'ab1');
    // No error yet: errors only appear after the first attempt.
    expect(number).not.toBeInvalid();
    await user.click(screen.getByRole('button', { name: 'Review and save' }));
    expect(number).toHaveAccessibleDescription('Enter at least 4 characters.');

    await user.type(number, ';2');
    expect(number).toHaveAccessibleDescription(
      'Use only digits, letters, spaces and hyphens, and start with a digit or letter.',
    );
    await user.clear(number);
    await user.type(number, '110 123-456789');
    expect(number).not.toBeInvalid();
    expect(number).toHaveAccessibleDescription(/Digits, letters, spaces and hyphens only/);
  });

  it('asks for the missing half of a language that was started, on the tab where it is', async () => {
    servePayment(activeInstruction());
    const user = userEvent.setup();
    renderApp('/admin/payment-info');

    await screen.findByLabelText('Account number');
    await user.click(screen.getByRole('tab', { name: 'English Empty' }));
    await user.type(screen.getByLabelText('Bank'), 'Shinhan Bank');
    await user.click(screen.getByRole('tab', { name: /^한국어/ }));
    expect(screen.getByLabelText('Bank')).toHaveValue('신한은행');
    await user.click(screen.getByRole('button', { name: 'Review and save' }));

    // Jumps to the English tab, to the field that is blank.
    expect(
      screen.getByRole('tab', { name: 'English Needs attention', selected: true }),
    ).toBeInTheDocument();
    const instructions = screen.getByLabelText('Instructions');
    expect(instructions).toHaveAccessibleDescription(
      expect.stringContaining('Fill in both fields for this language, or leave both empty.'),
    );
    expect(instructions).toHaveFocus();
    expect(screen.getByLabelText('Bank')).not.toBeInvalid();
    expect(api.find('PUT', PAYMENT_SAVE)).toBeUndefined();
  });

  it('requires the Korean text even when another language is complete', async () => {
    servePayment(activeInstruction());
    const user = userEvent.setup();
    renderApp('/admin/payment-info');

    await screen.findByLabelText('Account number');
    await user.clear(screen.getByLabelText('Bank'));
    await user.clear(screen.getByLabelText('Instructions'));
    await user.click(screen.getByRole('tab', { name: 'O‘zbekcha Written' }));
    await user.click(screen.getByRole('button', { name: 'Review and save' }));

    expect(
      screen.getByRole('tab', { name: '한국어 Needs attention', selected: true }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Bank')).toHaveAccessibleDescription(
      expect.stringContaining('This field is required.'),
    );
    expect(api.find('PUT', PAYMENT_SAVE)).toBeUndefined();
  });
});

describe('payment instructions: server errors', () => {
  it('keeps the preview open with a localized message, and saves on the next try', async () => {
    servePayment(activeInstruction());
    const save = api.handlers[PAYMENT_SAVE];
    let attempts = 0;
    api.handlers[PAYMENT_SAVE] = (url, init) => {
      attempts += 1;
      return attempts === 1
        ? apiError('SOURCE_TRANSLATION_REQUIRED', 422)
        : (save?.(url, init) ?? apiError('NOT_FOUND', 404));
    };
    const user = userEvent.setup();
    renderApp('/admin/payment-info');

    await user.type(await screen.findByLabelText('Account holder'), ' 2');
    const dialog = await openPreview(user);
    await user.click(dialog.getByRole('button', { name: 'Save and apply' }));

    // The server's own message text is never shown: the code is translated by the app.
    expect(await dialog.findByRole('alert')).toHaveTextContent(
      'Please add the text in the original (default) language.',
    );
    expect(dialog.getByRole('button', { name: 'Save and apply' })).toBeEnabled();
    expect(screen.queryByText('Payment instructions saved')).not.toBeInTheDocument();

    await user.click(dialog.getByRole('button', { name: 'Save and apply' }));
    expect(await screen.findByText('Payment instructions saved')).toBeInTheDocument();
    expect(calls('PUT', PAYMENT_SAVE)).toHaveLength(2);
  });

  it('shows a saving state and ignores further clicks while the request is in flight', async () => {
    servePayment(activeInstruction());
    const save = api.handlers[PAYMENT_SAVE];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.handlers[PAYMENT_SAVE] = async (url, init) => {
      await gate;
      return save?.(url, init) ?? apiError('NOT_FOUND', 404);
    };
    const user = userEvent.setup();
    renderApp('/admin/payment-info');

    await user.type(await screen.findByLabelText('Account holder'), ' 2');
    const dialog = await openPreview(user);
    const submit = dialog.getByRole('button', { name: 'Save and apply' });
    await user.click(submit);

    await waitFor(() => expect(submit).toBeDisabled());
    expect(submit).toHaveAttribute('aria-busy', 'true');
    expect(dialog.getByRole('button', { name: 'Keep editing' })).toBeDisabled();
    fireEvent.click(submit);
    release();
    expect(await screen.findByText('Payment instructions saved')).toBeInTheDocument();
    expect(calls('PUT', PAYMENT_SAVE)).toHaveLength(1);
  });
});

describe('payment instructions: leaving', () => {
  it('asks before throwing typed work away, and leaves straight away when nothing changed', async () => {
    servePayment(activeInstruction());
    const user = userEvent.setup();
    renderApp('/admin/payment-info');

    await user.type(await screen.findByLabelText('Account holder'), ' 2');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Discard your changes?' }));
    await user.click(dialog.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Discard your changes?' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Account holder')).toHaveValue('FOODBOLL FC 2');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Discard your changes?' })).getByRole(
        'button',
        { name: 'Discard and leave' },
      ),
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Admin' })).toBeInTheDocument();
    expect(api.find('PUT', PAYMENT_SAVE)).toBeUndefined();
  });

  it('does not ask when nothing was typed', async () => {
    servePayment(activeInstruction());
    const user = userEvent.setup();
    renderApp('/admin/payment-info');

    await screen.findByLabelText('Account number');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Admin' })).toBeInTheDocument();
  });
});

// ---- Legal documents --------------------------------------------------------------------------

const localized = (text: string, locale: string, requested: string) => ({
  text,
  locale,
  isFallback: locale !== requested,
});

const KO_TERMS = {
  title: '이용약관',
  body: '제1조 (목적)\n이 약관은 풋볼 모임 이용에 관한 규칙을 정합니다.',
};
const UZ_TERMS = {
  title: 'Foydalanish shartlari',
  body: '1-modda.\nBu shartlar qoidalarni belgilaydi.',
};
const EN_TERMS = { title: 'Terms of service', body: 'Article 1.\nThese terms set the rules.' };

type LegalTexts = Partial<Record<'ko' | 'uz' | 'en', { title: string; body: string }>>;

/** What the public endpoint answers: the reader's language when written, Korean otherwise. */
function legalView(type: string, version: number, texts: LegalTexts, lang: string) {
  const own = lang === 'ko' || lang === 'uz' || lang === 'en' ? texts[lang] : undefined;
  const locale = own ? lang : 'ko';
  const text = own ?? texts.ko;
  return {
    type,
    version,
    publishedAt: '2030-03-04T05:00:00.000Z',
    title: localized(text?.title ?? '', locale, lang),
    body: localized(text?.body ?? '', locale, lang),
  };
}

/** An in-memory document: publishing writes a new version that the public endpoint then serves. */
function serveLegal(type: string, initial: { version: number; texts: LegalTexts } | null) {
  let stored = initial;
  api.handlers[`/v1/legal/${type}`] = (url) =>
    stored
      ? json(legalView(type, stored.version, stored.texts, url.searchParams.get('lang') ?? 'ko'))
      : apiError('LEGAL_DOCUMENT_NOT_FOUND', 404);
  api.handlers[`/v1/admin/legal/${type}`] = (url, init) => {
    const input = JSON.parse(String(init?.body)) as { translations: LegalTexts };
    stored = { version: (stored?.version ?? 0) + 1, texts: input.translations };
    return json(
      legalView(type, stored.version, stored.texts, url.searchParams.get('lang') ?? 'ko'),
      201,
    );
  };
}

const PUBLISH = '/v1/admin/legal/TERMS';
const openPublish = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Review and publish' }));
  return within(await screen.findByRole('dialog', { name: 'Publish a new version?' }));
};

describe('legal documents: the list', () => {
  it('shows the four documents with their state, version and date, and links to each editor', async () => {
    serveLegal('TERMS', { version: 3, texts: { ko: KO_TERMS, en: EN_TERMS } });
    api.handlers['/v1/legal/PRIVACY'] = () => apiError('LEGAL_DOCUMENT_NOT_FOUND', 404);
    api.handlers['/v1/legal/CANCELLATION'] = () => apiError('INTERNAL_ERROR', 500);
    serveLegal('REFUND', { version: 1, texts: { ko: KO_TERMS } });
    renderApp('/admin/legal');

    const terms = await screen.findByRole('link', { name: /Terms of service/ });
    expect(terms).toHaveAttribute('href', '/admin/legal/TERMS');
    await waitFor(() => expect(terms).toHaveTextContent('Version 3 · published Mar 4, 2030'));
    expect(terms).toHaveTextContent('Published');

    const privacy = screen.getByRole('link', { name: /Privacy policy/ });
    expect(privacy).toHaveAttribute('href', '/admin/legal/PRIVACY');
    // Not published yet is a state, not an error.
    await waitFor(() => expect(privacy).toHaveTextContent('Nothing has been published yet.'));
    expect(privacy).toHaveTextContent('Not published');

    const cancellation = screen.getByRole('link', { name: /Cancellation policy/ });
    expect(cancellation).toHaveAttribute('href', '/admin/legal/CANCELLATION');
    await waitFor(() => expect(cancellation).toHaveTextContent('Status unavailable.'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again in a moment.',
    );

    const refund = screen.getByRole('link', { name: /Refund policy/ });
    expect(refund).toHaveAttribute('href', '/admin/legal/REFUND');
    await waitFor(() => expect(refund).toHaveTextContent('Version 1 · published Mar 4, 2030'));
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('asks the public endpoint for each document in the language of the admin and retries a failed one', async () => {
    api.handlers['/v1/legal/TERMS'] = () => apiError('INTERNAL_ERROR', 500);
    for (const other of ['PRIVACY', 'CANCELLATION', 'REFUND']) {
      api.handlers[`/v1/legal/${other}`] = () => apiError('LEGAL_DOCUMENT_NOT_FOUND', 404);
    }
    const user = userEvent.setup();
    renderApp('/admin/legal');

    await screen.findByRole('alert');
    expect(calls('GET', '/v1/legal/TERMS')[0]?.url.searchParams.get('lang')).toBe('en');
    serveLegal('TERMS', { version: 2, texts: { ko: KO_TERMS } });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: /Terms of service/ })).toHaveTextContent(
      'Version 2',
    );
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('is written in the language of the admin', async () => {
    signIn(api, me({ role: 'ADMIN', preferredLanguage: 'uz', effectiveLanguage: 'uz' }));
    chooseLanguageAndRegion('uz', 'all');
    api.handlers['/v1/legal/TERMS'] = () => apiError('LEGAL_DOCUMENT_NOT_FOUND', 404);
    renderApp('/admin/legal');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Shartlar va siyosat' }),
    ).toBeInTheDocument();
    expect((await screen.findAllByText('E’lon qilinmagan')).length).toBeGreaterThan(0);
  });

  it('is not offered to anyone but admins', async () => {
    signIn(api, me({ role: 'PLAYER' }));
    renderApp('/admin/legal');

    expect(await screen.findByText('You don’t have permission to do this.')).toBeInTheDocument();
    expect(calls('GET', '/v1/legal/TERMS')).toHaveLength(0);
  });
});

describe('legal documents: the editor', () => {
  it('fills each language from the published version, and only counts a language the server really has', async () => {
    serveLegal('TERMS', { version: 3, texts: { ko: KO_TERMS, en: EN_TERMS } });
    const user = userEvent.setup();
    renderApp('/admin/legal/TERMS');

    expect(await screen.findByLabelText('Title')).toHaveValue(KO_TERMS.title);
    expect(screen.getByLabelText('Text')).toHaveValue(KO_TERMS.body);
    // One request per language, in that language.
    expect(
      calls('GET', '/v1/legal/TERMS')
        .map((c) => c.url.searchParams.get('lang'))
        .sort(),
    ).toEqual(['en', 'ko', 'uz']);
    expect(screen.getByRole('tab', { name: '한국어 Written' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'English Written' })).toBeInTheDocument();
    // The server answered Uzbek with the Korean text: that is a fallback, so Uzbek is empty.
    expect(screen.getByRole('tab', { name: 'O‘zbekcha Empty' })).toBeInTheDocument();
    expect(screen.getByText('Version 3 · published Mar 4, 2030')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'O‘zbekcha Empty' }));
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.getByLabelText('Text')).toHaveValue('');
    await user.click(screen.getByRole('tab', { name: 'English Written' }));
    expect(screen.getByLabelText('Title')).toHaveValue(EN_TERMS.title);
    expect(screen.getByLabelText('Text')).toHaveValue(EN_TERMS.body);
  });

  it('explains that publishing is a new version for everyone and that old versions stay', async () => {
    serveLegal('TERMS', { version: 3, texts: { ko: KO_TERMS } });
    renderApp('/admin/legal/TERMS');

    expect(
      await screen.findByText(
        'When you publish, the new version applies to everyone right away. Earlier versions are not deleted; they are kept as history.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of service' })).toBeInTheDocument();
  });

  it('starts empty and says it will be the first version when nothing is published', async () => {
    serveLegal('TERMS', null);
    renderApp('/admin/legal/TERMS');

    expect(
      await screen.findByText(
        'Nothing is published yet. If you publish now, this becomes the first version.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Review and publish' })).toBeEnabled();
  });

  it('accepts the document name in any case in the address', async () => {
    serveLegal('PRIVACY', { version: 1, texts: { ko: KO_TERMS } });
    renderApp('/admin/legal/privacy');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Privacy policy' }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText('Title')).toHaveValue(KO_TERMS.title);
  });

  it('shows a not-found page for an unknown document, without asking the API', async () => {
    renderApp('/admin/legal/IMPRINT');

    expect(await screen.findByText('We couldn’t find what you requested.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All documents' })).toHaveAttribute(
      'href',
      '/admin/legal',
    );
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    expect(api.calls.some((c) => c.url.pathname.startsWith('/api/v1/legal/'))).toBe(false);
  });

  it('does not show an editor that could publish blind when a language failed to load', async () => {
    serveLegal('TERMS', { version: 3, texts: { ko: KO_TERMS, uz: UZ_TERMS } });
    const served = api.handlers['/v1/legal/TERMS'];
    let broken = true;
    api.handlers['/v1/legal/TERMS'] = (url, init) =>
      broken && url.searchParams.get('lang') === 'uz'
        ? apiError('INTERNAL_ERROR', 500)
        : (served?.(url, init) ?? apiError('NOT_FOUND', 404));
    const user = userEvent.setup();
    renderApp('/admin/legal/TERMS');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again in a moment.',
    );
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review and publish' })).not.toBeInTheDocument();

    broken = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Title')).toHaveValue(KO_TERMS.title);
    expect(screen.getByRole('tab', { name: 'O‘zbekcha Written' })).toBeInTheDocument();
  });

  it('is not offered to anyone but admins', async () => {
    signIn(api, me({ role: 'ORGANIZER' }));
    serveLegal('TERMS', { version: 3, texts: { ko: KO_TERMS } });
    renderApp('/admin/legal/TERMS');

    expect(await screen.findByText('You don’t have permission to do this.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    expect(calls('GET', '/v1/legal/TERMS')).toHaveLength(0);
  });
});

describe('legal documents: publishing', () => {
  it('confirms what changes per language, publishes a new version, and goes back to the refreshed list', async () => {
    serveLegal('TERMS', { version: 3, texts: { ko: KO_TERMS, en: EN_TERMS } });
    const user = userEvent.setup();
    renderApp('/admin/legal/TERMS');

    const body = await screen.findByLabelText('Text');
    fireEvent.change(body, { target: { value: `${KO_TERMS.body}\n제2조 (변경)` } });
    await user.click(screen.getByRole('tab', { name: 'O‘zbekcha Empty' }));
    await user.type(screen.getByLabelText('Title'), UZ_TERMS.title);
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: UZ_TERMS.body } });

    const dialog = await openPublish(user);
    expect(
      dialog.getByText(
        'You are publishing a new version of Terms of service, after version 3. It applies to everyone right away. Earlier versions are kept as history, and a published version can’t be edited or deleted.',
      ),
    ).toBeInTheDocument();
    const rows = dialog.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('한국어Written이용약관');
    expect(rows[1]).toHaveTextContent(`O‘zbekchaWritten${UZ_TERMS.title}`);
    expect(rows[2]).toHaveTextContent(`EnglishWritten${EN_TERMS.title}`);
    // Looking is not publishing.
    expect(api.find('PUT', PUBLISH)).toBeUndefined();

    await user.click(dialog.getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(api.find('PUT', PUBLISH)).toBeDefined());
    expect(bodyOf(api.find('PUT', PUBLISH))).toEqual({
      translations: {
        ko: { title: KO_TERMS.title, body: `${KO_TERMS.body}\n제2조 (변경)` },
        uz: UZ_TERMS,
        en: EN_TERMS,
      },
    });
    expect(await screen.findByText('Version 4 published')).toBeInTheDocument();
    // Back on the list, which reads the new version.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Terms and policies' }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Terms of service/ })).toHaveTextContent(
      'Version 4 · published Mar 4, 2030',
    );
  });

  it('publishes a first version and says so', async () => {
    serveLegal('TERMS', null);
    const user = userEvent.setup();
    renderApp('/admin/legal/TERMS');

    await user.type(await screen.findByLabelText('Title'), KO_TERMS.title);
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: KO_TERMS.body } });
    const dialog = await openPublish(user);

    expect(
      dialog.getByText(
        'You are publishing the first version of Terms of service. It applies to everyone right away.',
      ),
    ).toBeInTheDocument();
    const rows = dialog.getAllByRole('listitem');
    expect(rows[1]).toHaveTextContent('Empty. People who read this language see the Korean text.');
    expect(rows[2]).toHaveTextContent('Empty. People who read this language see the Korean text.');
    await user.click(dialog.getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(api.find('PUT', PUBLISH)).toBeDefined());
    expect(bodyOf(api.find('PUT', PUBLISH))).toEqual({ translations: { ko: KO_TERMS } });
    expect(await screen.findByText('Version 1 published')).toBeInTheDocument();
  });

  it('warns that a language is dropped from the new version when its text was cleared', async () => {
    serveLegal('TERMS', { version: 3, texts: { ko: KO_TERMS, uz: UZ_TERMS } });
    const user = userEvent.setup();
    renderApp('/admin/legal/TERMS');

    await screen.findByLabelText('Title');
    await user.click(screen.getByRole('tab', { name: 'O‘zbekcha Written' }));
    await user.clear(screen.getByLabelText('Title'));
    await user.clear(screen.getByLabelText('Text'));
    expect(screen.getByRole('tab', { name: 'O‘zbekcha Empty' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: '' } });
    await user.click(screen.getByRole('tab', { name: /^한국어/ }));
    await user.type(screen.getByLabelText('Title'), ' (개정)');

    const dialog = await openPublish(user);
    const rows = dialog.getAllByRole('listitem');
    expect(rows[1]).toHaveTextContent(
      'This language is in the published version but will not be in the new one. People who read it will see the Korean text.',
    );
    await user.click(dialog.getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(api.find('PUT', PUBLISH)).toBeDefined());
    expect(bodyOf(api.find('PUT', PUBLISH))).toEqual({
      translations: { ko: { title: `${KO_TERMS.title} (개정)`, body: KO_TERMS.body } },
    });
  });

  it('does not offer a publish while nothing differs from the published version', async () => {
    serveLegal('TERMS', { version: 3, texts: { ko: KO_TERMS } });
    const user = userEvent.setup();
    renderApp('/admin/legal/TERMS');

    const publish = await screen.findByRole('button', { name: 'Review and publish' });
    expect(publish).toBeDisabled();
    expect(screen.getByText('Nothing has changed from the published version.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Title'), '!');
    expect(publish).toBeEnabled();
  });

  it('keeps the dialog open with a localized message when publishing fails, and publishes on the next try', async () => {
    serveLegal('TERMS', { version: 3, texts: { ko: KO_TERMS } });
    const publishHandler = api.handlers[PUBLISH];
    let attempts = 0;
    api.handlers[PUBLISH] = (url, init) => {
      attempts += 1;
      return attempts === 1
        ? apiError('RATE_LIMITED', 429)
        : (publishHandler?.(url, init) ?? apiError('NOT_FOUND', 404));
    };
    const user = userEvent.setup();
    renderApp('/admin/legal/TERMS');

    await user.type(await screen.findByLabelText('Title'), '!');
    const dialog = await openPublish(user);
    await user.click(dialog.getByRole('button', { name: 'Publish' }));

    expect(await dialog.findByRole('alert')).toHaveTextContent(
      'Too many requests. Please wait a moment and try again.',
    );
    expect(dialog.getByRole('button', { name: 'Publish' })).toBeEnabled();
    expect(screen.queryByText(/published$/)).not.toBeInTheDocument();

    await user.click(dialog.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('Version 4 published')).toBeInTheDocument();
    expect(calls('PUT', PUBLISH)).toHaveLength(2);
  });

  it('shows a publishing state and sends the request once', async () => {
    serveLegal('TERMS', { version: 3, texts: { ko: KO_TERMS } });
    const publishHandler = api.handlers[PUBLISH];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.handlers[PUBLISH] = async (url, init) => {
      await gate;
      return publishHandler?.(url, init) ?? apiError('NOT_FOUND', 404);
    };
    const user = userEvent.setup();
    renderApp('/admin/legal/TERMS');

    await user.type(await screen.findByLabelText('Title'), '!');
    const dialog = await openPublish(user);
    const submit = dialog.getByRole('button', { name: 'Publish' });
    await user.click(submit);

    await waitFor(() => expect(submit).toBeDisabled());
    expect(submit).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(submit);
    release();
    expect(await screen.findByText('Version 4 published')).toBeInTheDocument();
    expect(calls('PUT', PUBLISH)).toHaveLength(1);
  });

  it('shows the text typed into a document as text, never as markup', async () => {
    serveLegal('TERMS', null);
    const user = userEvent.setup();
    const { container } = renderApp('/admin/legal/TERMS');

    await user.type(await screen.findByLabelText('Title'), 'x');
    fireEvent.change(screen.getByLabelText('Text'), {
      target: { value: '<script>alert(1)</script><b>bold</b>' },
    });
    await user.click(screen.getByRole('tab', { name: 'English Empty' }));
    await user.click(screen.getByRole('tab', { name: /^한국어/ }));
    expect(screen.getByLabelText('Text')).toHaveValue('<script>alert(1)</script><b>bold</b>');
    expect(container.querySelector('script, b')).toBeNull();
  });
});

describe('legal documents: validation', () => {
  it('asks for the Korean title and text, focuses the first problem and opens no dialog', async () => {
    serveLegal('TERMS', null);
    const user = userEvent.setup();
    renderApp('/admin/legal/TERMS');

    await user.click(await screen.findByRole('button', { name: 'Review and publish' }));

    expect(screen.getByLabelText('Title')).toHaveAccessibleDescription(
      expect.stringContaining('This field is required.'),
    );
    expect(screen.getByLabelText('Text')).toHaveAccessibleDescription(
      expect.stringContaining('This field is required.'),
    );
    expect(screen.getByLabelText('Title')).toHaveFocus();
    expect(screen.getByRole('tab', { name: '한국어 Needs attention' })).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: 'Publish a new version?' }),
    ).not.toBeInTheDocument();
    expect(api.find('PUT', PUBLISH)).toBeUndefined();
  });

  it('counts what is left of the limits and rejects a text over the limit on its own tab', async () => {
    serveLegal('TERMS', { version: 3, texts: { ko: KO_TERMS, uz: UZ_TERMS } });
    const user = userEvent.setup();
    renderApp('/admin/legal/TERMS');

    await screen.findByLabelText('Title');
    expect(screen.getByText(`${200 - KO_TERMS.title.length} characters left`)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'O‘zbekcha Written' }));
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'x'.repeat(100_005) } });
    expect(screen.getByText('5 characters over')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /^한국어/ }));
    await user.type(screen.getByLabelText('Title'), '!');
    await user.click(screen.getByRole('button', { name: 'Review and publish' }));

    // Back to the tab with the problem.
    expect(
      screen.getByRole('tab', { name: 'O‘zbekcha Needs attention', selected: true }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Text')).toHaveAccessibleDescription(
      expect.stringContaining('Enter 100000 characters or fewer.'),
    );
    expect(screen.getByLabelText('Text')).toHaveFocus();
    expect(api.find('PUT', PUBLISH)).toBeUndefined();
  });

  it('asks for the missing half of a language that was started', async () => {
    serveLegal('TERMS', { version: 3, texts: { ko: KO_TERMS } });
    const user = userEvent.setup();
    renderApp('/admin/legal/TERMS');

    await screen.findByLabelText('Title');
    await user.click(screen.getByRole('tab', { name: 'English Empty' }));
    await user.type(screen.getByLabelText('Title'), 'Terms of service');
    await user.click(screen.getByRole('button', { name: 'Review and publish' }));

    expect(screen.getByLabelText('Text')).toHaveAccessibleDescription(
      expect.stringContaining('Fill in both fields for this language, or leave both empty.'),
    );
    expect(screen.getByLabelText('Title')).not.toBeInvalid();
    expect(api.find('PUT', PUBLISH)).toBeUndefined();
  });
});

describe('legal documents: leaving', () => {
  it('asks before throwing typed work away', async () => {
    serveLegal('TERMS', { version: 3, texts: { ko: KO_TERMS } });
    const user = userEvent.setup();
    renderApp('/admin/legal/TERMS');

    await user.type(await screen.findByLabelText('Title'), '!');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Discard your changes?' })).getByRole(
        'button',
        { name: 'Discard and leave' },
      ),
    );

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Terms and policies' }),
    ).toBeInTheDocument();
    expect(api.find('PUT', PUBLISH)).toBeUndefined();
  });
});
