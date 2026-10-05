import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { I18nProvider } from '../i18n/I18nProvider';

type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let handlers: Record<string, Handler>;
let calls: { url: URL; init: RequestInit | undefined }[];

function setDeviceLanguages(languages: string[]) {
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(languages);
  vi.spyOn(window.navigator, 'language', 'get').mockReturnValue(languages[0] ?? 'en');
}

function renderApp(path = '/') {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </I18nProvider>,
  );
}

beforeEach(() => {
  calls = [];
  handlers = { '/api/v1/matches': () => json({ items: [], limit: 20, offset: 0 }) };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      calls.push({ url, init });
      const handler = handlers[url.pathname];
      return handler
        ? handler(url, init)
        : json({ error: { code: 'NOT_FOUND', message: '' } }, 404);
    }),
  );
  setDeviceLanguages(['en-US']);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('first launch', () => {
  it('shows the bilingual language prompt and both options', () => {
    renderApp();
    expect(screen.getByRole('heading', { name: '언어 선택 / Tilni tanlang' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '한국어' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'O‘zbekcha' })).toBeInTheDocument();
    expect(window.localStorage.getItem('foodboll.language')).toBeNull();
  });

  it('defaults to Korean and still asks when the device language is unsupported', () => {
    renderApp();
    expect(screen.getByRole('button', { name: '한국어' })).toHaveClass('suggested');
  });

  it('suggests Uzbek for an Uzbek device but does not skip or save anything', () => {
    setDeviceLanguages(['uz-UZ']);
    renderApp();
    expect(screen.getByRole('button', { name: 'O‘zbekcha' })).toHaveClass('suggested');
    expect(screen.getByRole('heading', { name: '언어 선택 / Tilni tanlang' })).toBeInTheDocument();
    expect(window.localStorage.getItem('foodboll.language')).toBeNull();
  });

  it('applies and remembers the chosen language', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'O‘zbekcha' }));

    expect(await screen.findByRole('link', { name: 'Matchlar' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Profil' })).toBeInTheDocument();
    expect(window.localStorage.getItem('foodboll.language')).toBe('uz');
    expect(document.documentElement.lang).toBe('uz-Latn-UZ');
    // Not signed in: nothing is sent to the account.
    expect(calls.filter((c) => c.init?.method === 'PATCH')).toEqual([]);
  });

  it('skips the prompt on later launches', () => {
    window.localStorage.setItem('foodboll.language', 'ko');
    renderApp();
    expect(
      screen.queryByRole('heading', { name: '언어 선택 / Tilni tanlang' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '매치' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('ko-KR');
  });

  it('ignores a corrupted stored value', () => {
    window.localStorage.setItem('foodboll.language', 'zz');
    renderApp();
    expect(screen.getByRole('heading', { name: '언어 선택 / Tilni tanlang' })).toBeInTheDocument();
  });
});

describe('changing language from settings', () => {
  it('follows 마이페이지 → 설정 → 언어 and switches instantly (Profil → Sozlamalar → Til)', async () => {
    window.localStorage.setItem('foodboll.language', 'ko');
    const user = userEvent.setup();
    renderApp('/me');

    await user.click(screen.getByRole('link', { name: '설정' }));
    await user.click(screen.getByRole('link', { name: /^언어/ }));
    expect(screen.getByRole('heading', { name: '언어' })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'O‘zbekcha' }));

    const crumbs = screen.getByRole('navigation', { name: 'Joriy joy' });
    expect(
      within(crumbs)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Profil', 'Sozlamalar', 'Til']);
    expect(screen.getByRole('radio', { name: 'O‘zbekcha' })).toBeChecked();
    expect(window.localStorage.getItem('foodboll.language')).toBe('uz');
  });
});

describe('signed-in users', () => {
  beforeEach(() => window.localStorage.setItem('foodboll.accessToken', 'a.b.c'));

  it('adopts the account language on a new device without showing the prompt', async () => {
    handlers['/api/v1/me'] = () =>
      json({
        id: 'u',
        displayName: 'Aziz',
        role: 'PLAYER',
        preferredLanguage: 'uz',
        effectiveLanguage: 'uz',
      });
    handlers['/api/v1/me/language'] = () => json({});
    renderApp();

    expect(await screen.findByRole('link', { name: 'Matchlar' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: '언어 선택 / Tilni tanlang' }),
    ).not.toBeInTheDocument();
    expect(window.localStorage.getItem('foodboll.language')).toBe('uz');
    const me = calls.find((c) => c.url.pathname === '/api/v1/me');
    expect((me?.init?.headers as Record<string, string>).Authorization).toBe('Bearer a.b.c');
  });

  it('shows the prompt when the account has no language yet, then saves the choice to the account', async () => {
    handlers['/api/v1/me'] = () =>
      json({
        id: 'u',
        displayName: 'X',
        role: 'PLAYER',
        preferredLanguage: null,
        effectiveLanguage: 'ko',
      });
    handlers['/api/v1/me/language'] = () => json({});
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'O‘zbekcha' }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.init?.method === 'PATCH' &&
            c.init.body === JSON.stringify({ preferredLanguage: 'uz' }),
        ),
      ).toBe(true),
    );
  });

  it('keeps the language applied locally and says so when saving to the account fails', async () => {
    window.localStorage.setItem('foodboll.language', 'ko');
    handlers['/api/v1/me'] = () =>
      json({
        id: 'u',
        displayName: 'X',
        role: 'PLAYER',
        preferredLanguage: 'ko',
        effectiveLanguage: 'ko',
      });
    handlers['/api/v1/me/language'] = (_url, init) =>
      init?.body && String(init.body).includes('preferredLanguage')
        ? json({ error: { code: 'INTERNAL_ERROR', message: '' } }, 500)
        : json({});
    const user = userEvent.setup();
    renderApp('/me/settings/language');

    await user.click(await screen.findByRole('radio', { name: 'O‘zbekcha' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Tilni hisobingizga saqlab bo‘lmadi. U ushbu qurilmada qo‘llanildi.',
    );
    expect(window.localStorage.getItem('foodboll.language')).toBe('uz');
  });

  it('does not hang on the splash screen when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    renderApp();
    expect(
      await screen.findByRole('heading', { name: '언어 선택 / Tilni tanlang' }),
    ).toBeInTheDocument();
  });
});

describe('localized content', () => {
  const match = (isFallback: boolean) => ({
    id: 'm1',
    startsAt: '2026-11-01T01:00:00.000Z',
    playersPerSide: 5,
    feeKrw: 10000,
    sourceLanguage: 'ko',
    title: { text: '서울 풋살장 5v5 매치', locale: 'ko', isFallback },
    description: null,
    rules: { text: '규정 풋살 룰', locale: 'ko', isFallback },
    locationInstructions: null,
    equipmentRequirements: null,
    cancellationPolicy: null,
  });

  it('asks the server for the reader language and tells Uzbek readers when they see the original', async () => {
    window.localStorage.setItem('foodboll.language', 'uz');
    handlers['/api/v1/matches/m1'] = () => json(match(true));
    renderApp('/matches/m1');

    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('서울 풋살장 5v5 매치');
    expect(within(heading).getByText('서울 풋살장 5v5 매치')).toHaveAttribute('lang', 'ko-KR');
    expect(screen.getAllByText('Asl matn (한국어) ko‘rsatilmoqda.').length).toBeGreaterThan(0);
    expect(screen.getByText('5x5')).toBeInTheDocument();
    expect(screen.getByText('1-noyabr 2026, yakshanba, 10:00')).toBeInTheDocument();
    expect(calls.at(-1)?.url.searchParams.get('lang')).toBe('uz');
  });

  it('shows no notice when the content is in the reader language', async () => {
    window.localStorage.setItem('foodboll.language', 'ko');
    handlers['/api/v1/matches/m1'] = () => json(match(false));
    renderApp('/matches/m1');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText(/원문/)).not.toBeInTheDocument();
    expect(screen.getByText('5v5')).toBeInTheDocument();
  });

  it('localizes API errors from the stable code in the client catalog', async () => {
    window.localStorage.setItem('foodboll.language', 'uz');
    handlers['/api/v1/matches/m1'] = () =>
      json({ error: { code: 'MATCH_NOT_FOUND', message: 'ignored' } }, 404);
    renderApp('/matches/m1');
    expect(await screen.findByRole('alert')).toHaveTextContent('Match topilmadi.');
  });

  it('renders payment details with untranslated account data and a localized bank name', async () => {
    window.localStorage.setItem('foodboll.language', 'uz');
    window.localStorage.setItem('foodboll.accessToken', 'a.b.c');
    handlers['/api/v1/me'] = () =>
      json({
        id: 'u',
        displayName: 'A',
        role: 'PLAYER',
        preferredLanguage: 'uz',
        effectiveLanguage: 'uz',
      });
    handlers['/api/v1/payment-instructions/current'] = () =>
      json({
        id: 'p',
        bankName: { text: 'Kookmin Bank', locale: 'uz', isFallback: false },
        accountNumber: '123-456-789012',
        accountHolder: 'FOOTBALL TEAM',
        instructions: {
          text: 'To‘lovni amalga oshirgandan so‘ng chekni yuklang.',
          locale: 'uz',
          isFallback: false,
        },
      });
    renderApp('/me/payment');
    expect(await screen.findByText('Kookmin Bank')).toBeInTheDocument();
    expect(screen.getByText('123-456-789012')).toBeInTheDocument();
    expect(screen.getByText('FOOTBALL TEAM')).toBeInTheDocument();
    expect(screen.getByText('Hisob egasi')).toBeInTheDocument();
    expect(
      screen.getByText('To‘lovni amalga oshirgandan so‘ng chekni yuklang.'),
    ).toBeInTheDocument();
  });

  it('renders user content as text, never as HTML', async () => {
    window.localStorage.setItem('foodboll.language', 'ko');
    handlers['/api/v1/matches/m1'] = () =>
      json({
        ...match(false),
        title: { text: '<img src=x onerror=alert(1)>', locale: 'ko', isFallback: false },
      });
    const { container } = renderApp('/matches/m1');
    await screen.findByRole('heading', { level: 1 });
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('registration and payment', () => {
  const summary = {
    id: 'm1',
    startsAt: '2026-12-01T01:00:00.000Z',
    playersPerSide: 5,
    maxPlayers: 10,
    feeKrw: 10000,
    sourceLanguage: 'ko',
    title: { text: '서울 풋살장 5v5 매치', locale: 'ko', isFallback: true },
  };
  const registration = (overrides: Record<string, unknown> = {}) => ({
    id: 'r1',
    status: 'APPLIED',
    createdAt: '2026-10-01T00:00:00.000Z',
    match: summary,
    payment: {
      status: 'AWAITING_PAYMENT',
      amountKrw: 10000,
      dueAt: '2026-11-30T01:00:00.000Z',
      hasReceipt: false,
      rejectReason: null,
    },
    ...overrides,
  });

  beforeEach(() => {
    window.localStorage.setItem('foodboll.language', 'uz');
    window.localStorage.setItem('foodboll.accessToken', 'a.b.c');
    handlers['/api/v1/me'] = () =>
      json({
        id: 'u',
        displayName: 'A',
        role: 'PLAYER',
        preferredLanguage: 'uz',
        effectiveLanguage: 'uz',
      });
    handlers['/api/v1/me/language'] = () => json({});
  });

  it('applies to a match and lands on my registrations', async () => {
    handlers['/api/v1/matches/m1'] = () =>
      json({
        ...summary,
        description: null,
        rules: null,
        locationInstructions: null,
        equipmentRequirements: null,
        cancellationPolicy: null,
      });
    handlers['/api/v1/matches/m1/registrations'] = () => json(registration(), 201);
    handlers['/api/v1/me/registrations'] = () =>
      json({ items: [registration()], limit: 20, offset: 0 });
    const user = userEvent.setup();
    renderApp('/matches/m1');

    await user.click(await screen.findByRole('button', { name: 'Matchga yozilish' }));
    expect(await screen.findByRole('heading', { name: 'Mening arizalarim' })).toBeInTheDocument();
    expect(screen.getByText('Ariza yuborildi')).toBeInTheDocument();
    expect(screen.getByText('To‘lov kutilmoqda')).toBeInTheDocument();
    expect(
      calls.some(
        (c) => c.init?.method === 'POST' && c.url.pathname.endsWith('/matches/m1/registrations'),
      ),
    ).toBe(true);
  });

  it('shows a localized error when the application is refused', async () => {
    handlers['/api/v1/matches/m1'] = () =>
      json({
        ...summary,
        description: null,
        rules: null,
        locationInstructions: null,
        equipmentRequirements: null,
        cancellationPolicy: null,
      });
    handlers['/api/v1/matches/m1/registrations'] = () =>
      json({ error: { code: 'MATCH_FULL', message: 'ignored' } }, 409);
    const user = userEvent.setup();
    renderApp('/matches/m1');
    await user.click(await screen.findByRole('button', { name: 'Matchga yozilish' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Joylar to‘lgan.');
  });

  it('uploads a receipt as the raw file with its own content type', async () => {
    handlers['/api/v1/me/registrations'] = () =>
      json({ items: [registration()], limit: 20, offset: 0 });
    handlers['/api/v1/registrations/r1/receipt'] = () => json(registration());
    const user = userEvent.setup();
    const { container } = renderApp('/me/registrations');
    await screen.findByText('To‘lov chekini yuklash');

    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'receipt.png', {
      type: 'image/png',
    });
    await user.upload(container.querySelector('input[type=file]') as HTMLInputElement, file);

    await waitFor(() => {
      const put = calls.find((c) => c.init?.method === 'PUT');
      expect(put?.url.pathname).toBe('/api/v1/registrations/r1/receipt');
      expect((put?.init?.headers as Record<string, string>)['Content-Type']).toBe('image/png');
      expect(put?.init?.body).toBe(file);
    });
  });

  it('rejects unsupported files on the device without sending anything', async () => {
    handlers['/api/v1/me/registrations'] = () =>
      json({ items: [registration()], limit: 20, offset: 0 });
    const user = userEvent.setup({ applyAccept: false });
    const { container } = renderApp('/me/registrations');
    await screen.findByText('To‘lov chekini yuklash');
    await user.upload(
      container.querySelector('input[type=file]') as HTMLInputElement,
      new File(['hi'], 'x.txt', { type: 'text/plain' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Faqat JPG, PNG yoki PDF fayl yuklash mumkin.',
    );
    expect(calls.some((c) => c.init?.method === 'PUT')).toBe(false);
  });

  it('explains a rejection in the player language and offers a new upload', async () => {
    handlers['/api/v1/me/registrations'] = () =>
      json({
        items: [
          registration({
            payment: {
              status: 'PAYMENT_REJECTED',
              amountKrw: 10000,
              dueAt: '2026-11-30T01:00:00.000Z',
              hasReceipt: true,
              rejectReason: 'AMOUNT_MISMATCH',
            },
          }),
        ],
        limit: 20,
        offset: 0,
      });
    renderApp('/me/registrations');
    expect(await screen.findByText('To‘lov summasi mos kelmadi')).toBeInTheDocument();
    expect(screen.getByText('To‘lov tasdiqlanmadi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'To‘lov chekini yuklash' })).toBeEnabled();
  });

  it('cancels a registration', async () => {
    handlers['/api/v1/me/registrations'] = () =>
      json({ items: [registration()], limit: 20, offset: 0 });
    handlers['/api/v1/registrations/r1/cancel'] = () => json(registration({ status: 'CANCELLED' }));
    const user = userEvent.setup();
    renderApp('/me/registrations');
    await user.click(await screen.findByRole('button', { name: 'Arizani bekor qilish' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.init?.method === 'POST' && c.url.pathname.endsWith('/r1/cancel')),
      ).toBe(true),
    );
  });
});
