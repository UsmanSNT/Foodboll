import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  chooseLanguageAndRegion,
  gangnam,
  json,
  me,
  mockApi,
  renderApp,
  seoul,
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
const english = (text: string) => ({ text, locale: 'en', isFallback: false });
const pageOf = (items: unknown[], offset = 0) => json({ items, limit: 20, offset });

// ---- Applications -------------------------------------------------------------------------------

const APPLICATIONS = '/v1/admin/organizer-applications';

const application = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  status: 'PENDING',
  region: gangnam,
  message: 'I play every Friday in Gangnam.',
  createdAt: '2030-04-01T03:00:00.000Z',
  reviewedAt: null,
  applicant: { id: `u-${id}`, displayName: name },
  ...overrides,
});

/** An in-memory review queue: deciding an application moves it between the status lists. */
function serveApplications(initial: ReturnType<typeof application>[]) {
  const all = [...initial];
  api.handlers[APPLICATIONS] = (url) => {
    const status = url.searchParams.get('status');
    const offset = Number(url.searchParams.get('offset'));
    return pageOf(all.filter((a) => a.status === status).slice(offset, offset + 20), offset);
  };
  for (const a of initial) {
    for (const [action, status] of [
      ['approve', 'APPROVED'],
      ['reject', 'REJECTED'],
    ] as const) {
      api.handlers[`${APPLICATIONS}/${a.id}/${action}`] = () => {
        const found = all.find((x) => x.id === a.id);
        if (found) Object.assign(found, { status, reviewedAt: '2030-04-02T03:00:00.000Z' });
        return json(found);
      };
    }
  }
  return all;
}

describe('organizer applications', () => {
  it('lists pending applications first, with who applied, where, what they wrote and when', async () => {
    serveApplications([
      application('a1', 'Dilnoza'),
      application('a2', 'Aziz Karimov', { message: null }),
    ]);
    renderApp('/admin/applications');

    const card = await screen.findByRole('article', { name: 'Dilnoza' });
    const scope = within(card);
    expect(scope.getByText('Seoul Gangnam-gu')).toBeInTheDocument();
    expect(scope.getByText('I play every Friday in Gangnam.')).toBeInTheDocument();
    expect(scope.getByText('Applied Apr 1, 2030')).toBeInTheDocument();
    expect(scope.getByRole('button', { name: 'Approve: Dilnoza' })).toBeEnabled();
    expect(scope.getByRole('button', { name: 'Reject: Dilnoza' })).toBeEnabled();
    expect(
      within(screen.getByRole('article', { name: 'Aziz Karimov' })).getByText(
        'No message was left.',
      ),
    ).toBeInTheDocument();

    expect(screen.getByRole('tab', { name: 'Pending', selected: true })).toBeInTheDocument();
    const request = calls('GET', APPLICATIONS)[0];
    expect(Object.fromEntries(request?.url.searchParams ?? [])).toEqual({
      status: 'PENDING',
      limit: '20',
      offset: '0',
      lang: 'en',
    });
  });

  it('shows what the applicant wrote as plain text, never as markup', async () => {
    serveApplications([
      application('a1', 'Dilnoza', { message: '<img src=x onerror="alert(1)"> <b>hello</b>' }),
    ]);
    const { container } = renderApp('/admin/applications');

    expect(
      await screen.findByText('<img src=x onerror="alert(1)"> <b>hello</b>'),
    ).toBeInTheDocument();
    expect(container.querySelector('img, b')).toBeNull();
  });

  it('shows decided applications under their own tab, without decision buttons', async () => {
    serveApplications([
      application('a1', 'Dilnoza', { status: 'APPROVED', reviewedAt: '2030-04-02T03:00:00.000Z' }),
      application('a2', 'Aziz Karimov', {
        status: 'REJECTED',
        reviewedAt: '2030-04-03T03:00:00.000Z',
      }),
    ]);
    const user = userEvent.setup();
    renderApp('/admin/applications');
    await screen.findByRole('heading', { name: 'All caught up' });

    await user.click(screen.getByRole('tab', { name: 'Approved' }));
    const approved = await screen.findByRole('article', { name: 'Dilnoza' });
    expect(within(approved).getByText('Approved')).toBeInTheDocument();
    expect(
      within(approved).getByText('Applied Apr 1, 2030 · Reviewed Apr 2, 2030'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Approve|Reject)/ })).not.toBeInTheDocument();
    expect(
      calls('GET', APPLICATIONS).some((c) => c.url.searchParams.get('status') === 'APPROVED'),
    ).toBe(true);

    await user.click(screen.getByRole('tab', { name: 'Rejected' }));
    const rejected = await screen.findByRole('article', { name: 'Aziz Karimov' });
    expect(within(rejected).getByText('Rejected')).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Dilnoza' })).not.toBeInTheDocument();
  });

  it('says plainly when nothing is waiting, and when a history tab is empty', async () => {
    serveApplications([]);
    const user = userEvent.setup();
    renderApp('/admin/applications');

    expect(await screen.findByRole('heading', { name: 'All caught up' })).toBeInTheDocument();
    expect(
      screen.getByText('No applications are waiting for review. New ones will show up here.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Approved' }));
    expect(
      await screen.findByRole('heading', { name: 'No approved applications' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Rejected' }));
    expect(
      await screen.findByRole('heading', { name: 'No rejected applications' }),
    ).toBeInTheDocument();
  });

  it('asks before approving and says exactly what approval does', async () => {
    serveApplications([application('a1', 'Dilnoza')]);
    const user = userEvent.setup();
    renderApp('/admin/applications');

    await user.click(await screen.findByRole('button', { name: 'Approve: Dilnoza' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve this application?' });
    expect(
      within(dialog).getByText(
        'Dilnoza will be able to announce matches in Seoul Gangnam-gu. If they are still a player, they become an organizer.',
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'They get a notification in their own language. You can change their regions later under Users.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/whole province/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(calls('POST', `${APPLICATIONS}/a1/approve`)).toHaveLength(0);
    expect(screen.getByRole('article', { name: 'Dilnoza' })).toBeInTheDocument();
  });

  it('approves, confirms with a toast, and refreshes the list and the users', async () => {
    serveApplications([application('a1', 'Dilnoza'), application('a2', 'Aziz Karimov')]);
    api.handlers['/v1/admin/users'] = () => pageOf([]);
    const user = userEvent.setup();
    renderApp('/admin/applications');

    await user.click(await screen.findByRole('button', { name: 'Approve: Dilnoza' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve this application?' });
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('Application approved.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('article', { name: 'Dilnoza' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('article', { name: 'Aziz Karimov' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const post = calls('POST', `${APPLICATIONS}/a1/approve`);
    expect(post).toHaveLength(1);
    expect(post[0]?.init?.body).toBeUndefined();
    expect(calls('GET', APPLICATIONS)).toHaveLength(2);
  });

  it('tells the admin that approving a province covers its districts', async () => {
    serveApplications([application('a1', 'Dilnoza', { region: seoul })]);
    const user = userEvent.setup();
    renderApp('/admin/applications');

    const card = await screen.findByRole('article', { name: 'Dilnoza' });
    expect(within(card).getByText('Seoul')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Approve: Dilnoza' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve this application?' });
    expect(
      within(dialog).getByText('This is a whole province, so every district in it is included.'),
    ).toBeInTheDocument();
  });

  it('asks before rejecting, says the role stays and that it cannot be undone, then rejects', async () => {
    serveApplications([application('a1', 'Dilnoza'), application('a2', 'Aziz Karimov')]);
    const user = userEvent.setup();
    renderApp('/admin/applications');

    await user.click(await screen.findByRole('button', { name: 'Reject: Aziz Karimov' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reject this application?' });
    expect(
      within(dialog).getByText(
        'The application from Aziz Karimov for Seoul Gangnam-gu will be declined. Their role stays the same.',
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'They get a notification in their own language. This can’t be undone, but they can apply again.',
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));

    expect(await screen.findByText('Application rejected.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('article', { name: 'Aziz Karimov' })).not.toBeInTheDocument(),
    );
    expect(calls('POST', `${APPLICATIONS}/a2/reject`)).toHaveLength(1);
    expect(calls('POST', `${APPLICATIONS}/a2/approve`)).toHaveLength(0);
    expect(screen.getByRole('article', { name: 'Dilnoza' })).toBeInTheDocument();
  });

  it('blocks repeat clicks while a decision is being sent', async () => {
    serveApplications([application('a1', 'Dilnoza')]);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    api.handlers[`${APPLICATIONS}/a1/approve`] = async () => {
      await gate;
      return json(application('a1', 'Dilnoza', { status: 'APPROVED' }));
    };
    const user = userEvent.setup();
    renderApp('/admin/applications');

    await user.click(await screen.findByRole('button', { name: 'Approve: Dilnoza' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve this application?' });
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));

    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Approve' })).toBeDisabled(),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    release();
    await screen.findByText('Application approved.');
    expect(calls('POST', `${APPLICATIONS}/a1/approve`)).toHaveLength(1);
  });

  it('explains an application another admin already decided, and refreshes the list', async () => {
    const all = serveApplications([application('a1', 'Dilnoza')]);
    api.handlers[`${APPLICATIONS}/a1/approve`] = () => {
      Object.assign(all[0] ?? {}, { status: 'REJECTED' });
      return apiError('INVALID_STATE', 409);
    };
    const user = userEvent.setup();
    renderApp('/admin/applications');

    await user.click(await screen.findByRole('button', { name: 'Approve: Dilnoza' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve this application?' });
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));

    expect(
      await within(dialog).findByText(
        'Another admin has already decided on this application. The list was refreshed.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('article', { name: 'Dilnoza' })).not.toBeInTheDocument(),
    );
    // The sheet's own X button and the form's Close button share a name; the form's comes last.
    await user.click(
      within(dialog).getAllByRole('button', { name: 'Close' }).at(-1) as HTMLElement,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'All caught up' })).toBeInTheDocument();
  });

  it('says so when the application no longer exists', async () => {
    serveApplications([application('a1', 'Dilnoza')]);
    api.handlers[`${APPLICATIONS}/a1/reject`] = () => apiError('APPLICATION_NOT_FOUND', 404);
    const user = userEvent.setup();
    renderApp('/admin/applications');

    await user.click(await screen.findByRole('button', { name: 'Reject: Dilnoza' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reject this application?' });
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'We couldn’t find this application.',
    );
    expect(within(dialog).queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('keeps the dialog open after a failure so the decision can be retried', async () => {
    serveApplications([application('a1', 'Dilnoza')]);
    const approve = api.handlers[`${APPLICATIONS}/a1/approve`]!;
    let fail = true;
    api.handlers[`${APPLICATIONS}/a1/approve`] = (url, init) =>
      fail ? apiError('INTERNAL_ERROR', 500) : approve(url, init);
    const user = userEvent.setup();
    renderApp('/admin/applications');

    await user.click(await screen.findByRole('button', { name: 'Approve: Dilnoza' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve this application?' });
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again in a moment.',
    );
    expect(within(dialog).getByRole('button', { name: 'Approve' })).toBeEnabled();

    fail = false;
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Application approved.')).toBeInTheDocument();
  });

  it('loads more applications a page at a time', async () => {
    serveApplications(
      Array.from({ length: 21 }, (_, i) =>
        application(`a${i}`, `Applicant ${String(i).padStart(2, '0')}`),
      ),
    );
    const user = userEvent.setup();
    renderApp('/admin/applications');

    await screen.findByRole('article', { name: 'Applicant 00' });
    expect(screen.getAllByRole('article')).toHaveLength(20);
    await user.click(screen.getByRole('button', { name: 'Show more' }));

    expect(await screen.findByRole('article', { name: 'Applicant 20' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(21);
    expect(calls('GET', APPLICATIONS).map((c) => c.url.searchParams.get('offset'))).toEqual([
      '0',
      '20',
    ]);
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('shows a localized error with a way to retry', async () => {
    serveApplications([application('a1', 'Dilnoza')]);
    const ok = api.handlers[APPLICATIONS]!;
    let fail = true;
    api.handlers[APPLICATIONS] = (url, init) =>
      fail ? apiError('INTERNAL_ERROR', 500) : ok(url, init);
    const user = userEvent.setup();
    renderApp('/admin/applications');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again in a moment.',
    );
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('article', { name: 'Dilnoza' })).toBeInTheDocument();
  });
});

// ---- Users ----------------------------------------------------------------------------------------

const USERS = '/v1/admin/users';

const person = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  displayName: name,
  role: 'PLAYER',
  preferredLanguage: 'en',
  organizerRegions: [],
  deviceLocale: 'en-US',
  createdAt: '2030-03-01T03:00:00.000Z',
  ...overrides,
});

type Person = ReturnType<typeof person>;

const node = (code: string, name: string, level: 1 | 2, children: unknown[] = []) => ({
  id: `r-${code}`,
  code,
  name: english(name),
  level,
  upcomingMatches: 0,
  children,
});
const regionTree = {
  items: [
    node('seoul', 'Seoul', 1, [
      node('seoul-gangnam', 'Gangnam-gu', 2),
      node('seoul-songpa', 'Songpa-gu', 2),
    ]),
    node('gyeonggi', 'Gyeonggi', 1, [
      node('gyeonggi-suwon', 'Suwon', 2),
      node('gyeonggi-seongnam', 'Seongnam', 2),
    ]),
    node('sejong', 'Sejong', 1),
  ],
};

/** Serves the users the filter allows and applies organizer-region changes the way the API does. */
function serveUsers(initial: Person[]) {
  const all = [...initial];
  api.handlers[USERS] = (url) => {
    const language = url.searchParams.get('language');
    const offset = Number(url.searchParams.get('offset'));
    const matching = all.filter((u) =>
      language === null
        ? true
        : language === 'none'
          ? u.preferredLanguage === null
          : u.preferredLanguage === language,
    );
    return pageOf(matching.slice(offset, offset + 20), offset);
  };
  api.handlers['/v1/regions'] = () => json(regionTree);
  for (const u of initial) {
    api.handlers[`${USERS}/${u.id}/organizer-regions`] = (_url, init) => {
      const { regionCodes } = JSON.parse(String(init?.body)) as { regionCodes: string[] };
      const found = all.find((x) => x.id === u.id);
      if (found)
        Object.assign(found, {
          organizerRegions: regionCodes,
          role: regionCodes.length > 0 ? 'ORGANIZER' : 'PLAYER',
        });
      return json({ organizerRegions: regionCodes });
    };
  }
  return all;
}

const openUser = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(await screen.findByRole('button', { name: new RegExp(name) }));
  return screen.findByRole('dialog', { name: 'Organizer regions' });
};

describe('users', () => {
  it('shows each person with role, chosen language and the raw device language, and no nationality', async () => {
    serveUsers([
      person('u1', 'Aziz Karimov'),
      person('u2', 'Dilnoza', {
        role: 'ORGANIZER',
        preferredLanguage: 'uz',
        deviceLocale: 'uz-Latn-UZ',
        organizerRegions: ['seoul', 'gyeonggi-suwon'],
      }),
      person('u3', 'Bek Admin', { role: 'ADMIN', preferredLanguage: null, deviceLocale: null }),
    ]);
    const { container } = renderApp('/admin/users');

    const aziz = within(await screen.findByRole('button', { name: /Aziz Karimov/ }));
    expect(aziz.getByText('Player')).toBeInTheDocument();
    expect(aziz.getByText('English')).toBeInTheDocument();
    expect(aziz.getByText('Device language: en-US')).toBeInTheDocument();
    expect(aziz.queryByText(/region/i)).not.toBeInTheDocument();

    const dilnoza = within(screen.getByRole('button', { name: /Dilnoza/ }));
    expect(dilnoza.getByText('Organizer')).toBeInTheDocument();
    expect(dilnoza.getByText('O‘zbekcha')).toBeInTheDocument();
    expect(dilnoza.getByText('Device language: uz-Latn-UZ')).toBeInTheDocument();
    expect(dilnoza.getByText('2 regions')).toBeInTheDocument();

    const bek = within(screen.getByRole('button', { name: /Bek Admin/ }));
    expect(bek.getByText('Admin')).toBeInTheDocument();
    expect(bek.getByText('Not chosen')).toBeInTheDocument();
    expect(bek.getByText('Device language unknown')).toBeInTheDocument();

    expect(container.textContent).not.toMatch(/nationalit|citizen|country/i);
    const request = calls('GET', USERS)[0];
    expect(Object.fromEntries(request?.url.searchParams ?? [])).toEqual({
      limit: '20',
      offset: '0',
      lang: 'en',
    });
  });

  it('filters by language, including the people who never chose one', async () => {
    serveUsers([
      person('u1', 'Aziz Karimov'),
      person('u2', 'Dilnoza', { preferredLanguage: 'uz' }),
      person('u3', 'Minsu', { preferredLanguage: 'ko' }),
      person('u4', 'Newcomer', { preferredLanguage: null }),
    ]);
    const user = userEvent.setup();
    renderApp('/admin/users');
    await screen.findByRole('button', { name: /Aziz Karimov/ });

    const filter = within(screen.getByRole('group', { name: 'Filter by language' }));
    expect(filter.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'All',
      '한국어',
      'O‘zbekcha',
      'English',
      'Not chosen',
    ]);
    expect(filter.getByRole('button', { name: 'All', pressed: true })).toBeInTheDocument();
    const lastLanguage = () => calls('GET', USERS).at(-1)?.url.searchParams.get('language');

    await user.click(filter.getByRole('button', { name: 'O‘zbekcha' }));
    expect(await screen.findByRole('button', { name: /Dilnoza/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Aziz Karimov/ })).not.toBeInTheDocument(),
    );
    expect(lastLanguage()).toBe('uz');
    expect(filter.getByRole('button', { name: 'O‘zbekcha', pressed: true })).toBeInTheDocument();

    await user.click(filter.getByRole('button', { name: '한국어' }));
    expect(await screen.findByRole('button', { name: /Minsu/ })).toBeInTheDocument();
    expect(lastLanguage()).toBe('ko');

    await user.click(filter.getByRole('button', { name: 'Not chosen' }));
    expect(await screen.findByRole('button', { name: /Newcomer/ })).toBeInTheDocument();
    expect(lastLanguage()).toBe('none');

    await user.click(filter.getByRole('button', { name: 'All' }));
    expect(await screen.findByRole('button', { name: /Aziz Karimov/ })).toBeInTheDocument();
    expect(lastLanguage()).toBeNull();
  });

  it('has an empty state, and a different one when a filter is why it is empty', async () => {
    serveUsers([]);
    const user = userEvent.setup();
    renderApp('/admin/users');

    expect(await screen.findByRole('heading', { name: 'No users yet' })).toBeInTheDocument();
    await user.click(
      within(screen.getByRole('group', { name: 'Filter by language' })).getByRole('button', {
        name: 'English',
      }),
    );
    expect(
      await screen.findByText('Nobody uses this language. Try another one.'),
    ).toBeInTheDocument();
  });

  it('loads more people a page at a time', async () => {
    serveUsers(
      Array.from({ length: 21 }, (_, i) => person(`u${i}`, `Person ${String(i).padStart(2, '0')}`)),
    );
    const user = userEvent.setup();
    renderApp('/admin/users');

    await screen.findByRole('button', { name: /Person 00/ });
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByRole('button', { name: /Person 20/ })).toBeInTheDocument();
    expect(calls('GET', USERS).map((c) => c.url.searchParams.get('offset'))).toEqual(['0', '20']);
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('shows a localized error with a way to retry', async () => {
    serveUsers([person('u1', 'Aziz Karimov')]);
    const ok = api.handlers[USERS]!;
    let fail = true;
    api.handlers[USERS] = (url, init) => (fail ? apiError('INTERNAL_ERROR', 500) : ok(url, init));
    const user = userEvent.setup();
    renderApp('/admin/users');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again in a moment.',
    );
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: /Aziz Karimov/ })).toBeInTheDocument();
  });
});

describe('organizer regions', () => {
  const dilnoza = () =>
    person('u2', 'Dilnoza', {
      role: 'ORGANIZER',
      preferredLanguage: 'uz',
      deviceLocale: 'uz-Latn-UZ',
      organizerRegions: ['seoul', 'gyeonggi-suwon'],
    });

  it('opens a person with what they have, the language they chose and how the grants work', async () => {
    serveUsers([dilnoza()]);
    const user = userEvent.setup();
    renderApp('/admin/users');
    const dialog = within(await openUser(user, 'Dilnoza'));

    expect(dialog.getByRole('heading', { name: 'Dilnoza' })).toBeInTheDocument();
    expect(dialog.getByText('O‘zbekcha')).toBeInTheDocument();
    expect(dialog.getByText('Device language: uz-Latn-UZ')).toBeInTheDocument();
    expect(dialog.getByText('Joined Mar 1, 2030')).toBeInTheDocument();
    expect(
      dialog.getByText(
        'Choose where Dilnoza can announce matches. Selecting a province includes every district in it.',
      ),
    ).toBeInTheDocument();
    expect(await dialog.findByText('All of Seoul')).toBeInTheDocument();
    expect(dialog.getByText('Gyeonggi Suwon')).toBeInTheDocument();
    expect(dialog.getByText('2 of 50 selected')).toBeInTheDocument();
    expect(
      dialog.getByText('Removing every region turns Dilnoza back into a player.'),
    ).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('adds a district and saves the whole set, then refreshes the list', async () => {
    serveUsers([dilnoza()]);
    const user = userEvent.setup();
    renderApp('/admin/users');
    const dialog = within(await openUser(user, 'Dilnoza'));

    await user.click(await dialog.findByRole('button', { name: 'Districts of Gyeonggi' }));
    expect(dialog.getByRole('button', { name: 'Districts of Gyeonggi' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(dialog.getByRole('checkbox', { name: 'Suwon' })).toBeChecked();
    await user.click(dialog.getByRole('checkbox', { name: 'Seongnam' }));

    expect(dialog.getByText('Gyeonggi Seongnam')).toBeInTheDocument();
    expect(dialog.getByText('3 of 50 selected')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Organizer regions saved.')).toBeInTheDocument();
    expect(bodyOf(calls('PUT', `${USERS}/u2/organizer-regions`)[0])).toEqual({
      regionCodes: ['gyeonggi-seongnam', 'gyeonggi-suwon', 'seoul'],
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Organizer regions' })).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('3 regions')).toBeInTheDocument();
  });

  it('removes a region with its chip', async () => {
    serveUsers([dilnoza()]);
    const user = userEvent.setup();
    renderApp('/admin/users');
    const dialog = within(await openUser(user, 'Dilnoza'));

    await user.click(await dialog.findByRole('button', { name: 'Remove Gyeonggi Suwon' }));
    expect(dialog.queryByText('Gyeonggi Suwon')).not.toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls('PUT', `${USERS}/u2/organizer-regions`)).toHaveLength(1));
    expect(bodyOf(calls('PUT', `${USERS}/u2/organizer-regions`)[0])).toEqual({
      regionCodes: ['seoul'],
    });
  });

  it('lets a province cover its districts: they are included, not sent one by one', async () => {
    serveUsers([
      person('u1', 'Aziz Karimov', {
        role: 'ORGANIZER',
        organizerRegions: ['seoul-gangnam', 'seoul-songpa'],
      }),
    ]);
    const user = userEvent.setup();
    renderApp('/admin/users');
    const dialog = within(await openUser(user, 'Aziz Karimov'));

    await user.click(await dialog.findByRole('button', { name: 'Districts of Seoul' }));
    expect(dialog.getByRole('checkbox', { name: 'Gangnam-gu' })).toBeChecked();
    expect(dialog.getByRole('checkbox', { name: 'Gangnam-gu' })).toBeEnabled();

    await user.click(dialog.getByRole('checkbox', { name: /^Seoul/ }));
    expect(dialog.getByRole('checkbox', { name: /^Seoul/ })).toBeChecked();
    expect(dialog.getByText('All districts included')).toBeInTheDocument();
    expect(dialog.getByRole('checkbox', { name: 'Gangnam-gu' })).toBeChecked();
    expect(dialog.getByRole('checkbox', { name: 'Gangnam-gu' })).toBeDisabled();
    expect(dialog.getByText('All of Seoul')).toBeInTheDocument();
    expect(dialog.queryByText('Seoul Gangnam-gu')).not.toBeInTheDocument();
    expect(dialog.getByText('1 of 50 selected')).toBeInTheDocument();

    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls('PUT', `${USERS}/u1/organizer-regions`)).toHaveLength(1));
    expect(bodyOf(calls('PUT', `${USERS}/u1/organizer-regions`)[0])).toEqual({
      regionCodes: ['seoul'],
    });
  });

  it('counts the districts chosen inside a province that is not chosen itself', async () => {
    serveUsers([person('u1', 'Aziz Karimov')]);
    const user = userEvent.setup();
    renderApp('/admin/users');
    const dialog = within(await openUser(user, 'Aziz Karimov'));

    await user.click(await dialog.findByRole('button', { name: 'Districts of Seoul' }));
    await user.click(dialog.getByRole('checkbox', { name: 'Gangnam-gu' }));
    await user.click(dialog.getByRole('checkbox', { name: 'Songpa-gu' }));
    expect(dialog.getByRole('checkbox', { name: /^Seoul/ })).toHaveAccessibleName(
      'Seoul 2 selected',
    );
    expect(dialog.getByRole('checkbox', { name: /^Seoul/ })).not.toBeChecked();
  });

  it('makes a player an organizer by granting a region, and says so before saving', async () => {
    serveUsers([person('u1', 'Aziz Karimov')]);
    const user = userEvent.setup();
    renderApp('/admin/users');
    const dialog = within(await openUser(user, 'Aziz Karimov'));

    expect(
      await dialog.findByText('Select at least one region to make Aziz Karimov an organizer.'),
    ).toBeInTheDocument();
    expect(dialog.getByText('No regions selected.')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.click(dialog.getByRole('checkbox', { name: 'Sejong' }));
    expect(
      dialog.getByText('Aziz Karimov will become an organizer when you save.'),
    ).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls('PUT', `${USERS}/u1/organizer-regions`)).toHaveLength(1));
    expect(bodyOf(calls('PUT', `${USERS}/u1/organizer-regions`)[0])).toEqual({
      regionCodes: ['sejong'],
    });
    expect(
      await screen.findByRole('button', { name: /Aziz Karimov.*Organizer/ }),
    ).toBeInTheDocument();
  });

  it('warns that removing every region turns an organizer back into a player', async () => {
    serveUsers([person('u2', 'Dilnoza', { role: 'ORGANIZER', organizerRegions: ['sejong'] })]);
    const user = userEvent.setup();
    renderApp('/admin/users');
    const dialog = within(await openUser(user, 'Dilnoza'));

    expect(
      await dialog.findByText('Removing every region turns Dilnoza back into a player.'),
    ).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Remove All of Sejong' }));
    expect(dialog.getByRole('status')).toHaveTextContent(
      'Dilnoza will become a player again and can no longer announce matches.',
    );
    expect(
      dialog.queryByText('Removing every region turns Dilnoza back into a player.'),
    ).not.toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls('PUT', `${USERS}/u2/organizer-regions`)).toHaveLength(1));
    expect(bodyOf(calls('PUT', `${USERS}/u2/organizer-regions`)[0])).toEqual({ regionCodes: [] });
  });

  it('searches across provinces and districts, and says when nothing matches', async () => {
    serveUsers([person('u1', 'Aziz Karimov')]);
    const user = userEvent.setup();
    renderApp('/admin/users');
    const dialog = within(await openUser(user, 'Aziz Karimov'));
    const search = await dialog.findByRole('searchbox', { name: 'Search regions' });

    await user.type(search, 'suwon');
    expect(dialog.getByRole('checkbox', { name: 'Suwon' })).toBeInTheDocument();
    expect(dialog.queryByRole('checkbox', { name: 'Seongnam' })).not.toBeInTheDocument();
    expect(dialog.queryByRole('checkbox', { name: /^Seoul/ })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'zzz');
    expect(dialog.getByText('No matching regions.')).toBeInTheDocument();
    await user.clear(search);
    expect(dialog.getByRole('checkbox', { name: /^Seoul/ })).toBeInTheDocument();
    expect(dialog.queryByRole('checkbox', { name: 'Gangnam-gu' })).not.toBeInTheDocument();
  });

  it('does not offer to edit an admin: they can announce everywhere', async () => {
    serveUsers([person('u3', 'Bek Admin', { role: 'ADMIN' })]);
    const user = userEvent.setup();
    renderApp('/admin/users');
    const dialog = within(await openUser(user, 'Bek Admin'));

    expect(
      dialog.getByText(
        'Admins can announce matches in every region, so there is nothing to set here.',
      ),
    ).toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(dialog.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(calls('GET', '/v1/regions')).toHaveLength(0);
  });

  it('shows the API error and keeps the edit when saving fails, then saves on retry', async () => {
    serveUsers([dilnoza()]);
    const save = api.handlers[`${USERS}/u2/organizer-regions`]!;
    let fail = true;
    api.handlers[`${USERS}/u2/organizer-regions`] = (url, init) =>
      fail ? apiError('REGION_NOT_FOUND', 404) : save(url, init);
    const user = userEvent.setup();
    renderApp('/admin/users');
    const dialog = within(await openUser(user, 'Dilnoza'));

    await user.click(await dialog.findByRole('button', { name: 'Remove Gyeonggi Suwon' }));
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('We couldn’t find this region.');
    expect(dialog.getByText('1 of 50 selected')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Save' })).toBeEnabled();

    fail = false;
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Organizer regions saved.')).toBeInTheDocument();
    const puts = calls('PUT', `${USERS}/u2/organizer-regions`);
    expect(puts).toHaveLength(2);
    expect(bodyOf(puts[1])).toEqual({ regionCodes: ['seoul'] });
  });

  it('keeps regions the list no longer offers, so saving never revokes them silently', async () => {
    serveUsers([
      person('u2', 'Dilnoza', { role: 'ORGANIZER', organizerRegions: ['old-closed', 'sejong'] }),
    ]);
    const user = userEvent.setup();
    renderApp('/admin/users');
    const dialog = within(await openUser(user, 'Dilnoza'));

    expect(await dialog.findByText('Unavailable region')).toBeInTheDocument();
    await user.click(dialog.getByRole('checkbox', { name: 'Sejong' }));
    await user.click(dialog.getByRole('checkbox', { name: /^Seoul/ }));
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls('PUT', `${USERS}/u2/organizer-regions`)).toHaveLength(1));
    expect(bodyOf(calls('PUT', `${USERS}/u2/organizer-regions`)[0])).toEqual({
      regionCodes: ['old-closed', 'seoul'],
    });
  });

  it('stops at 50 regions: nothing more can be added, and a longer list cannot be saved', async () => {
    const stale = (n: number) =>
      Array.from(
        { length: n },
        (_, i) =>
          `old-${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`,
      );
    serveUsers([
      person('u2', 'Dilnoza', { role: 'ORGANIZER', organizerRegions: stale(50) }),
      person('u1', 'Aziz Karimov', { role: 'ORGANIZER', organizerRegions: stale(52) }),
    ]);
    const user = userEvent.setup();
    renderApp('/admin/users');

    const full = within(await openUser(user, 'Dilnoza'));
    expect(await full.findByText('50 of 50 selected')).toBeInTheDocument();
    expect(full.getByText('You can select up to 50 regions.')).toBeInTheDocument();
    expect(full.getByRole('checkbox', { name: 'Sejong' })).toBeDisabled();
    await user.click(full.getByRole('button', { name: 'Close' }));

    const over = within(await openUser(user, 'Aziz Karimov'));
    expect((await over.findAllByText('Unavailable region')).length).toBe(52);
    await user.click(
      over.getAllByRole('button', { name: 'Remove Unavailable region' })[0] as HTMLElement,
    );
    expect(over.getByText('51 of 50 selected')).toBeInTheDocument();
    expect(over.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.click(
      over.getAllByRole('button', { name: 'Remove Unavailable region' })[0] as HTMLElement,
    );
    expect(over.getByText('50 of 50 selected')).toBeInTheDocument();
    await user.click(over.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls('PUT', `${USERS}/u1/organizer-regions`)).toHaveLength(1));
    expect(
      (bodyOf(calls('PUT', `${USERS}/u1/organizer-regions`)[0]) as { regionCodes: string[] })
        .regionCodes,
    ).toHaveLength(50);
  });

  it('offers a retry when the region list cannot be loaded', async () => {
    serveUsers([dilnoza()]);
    let fail = true;
    api.handlers['/v1/regions'] = () => (fail ? apiError('INTERNAL_ERROR', 500) : json(regionTree));
    const user = userEvent.setup();
    renderApp('/admin/users');
    const dialog = within(await openUser(user, 'Dilnoza'));

    expect(await dialog.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again in a moment.',
    );
    fail = false;
    await user.click(dialog.getByRole('button', { name: 'Try again' }));
    expect(await dialog.findByText('All of Seoul')).toBeInTheDocument();
  });
});

// ---- Access ---------------------------------------------------------------------------------------

describe('access', () => {
  it.each([
    ['/admin/applications', APPLICATIONS],
    ['/admin/users', USERS],
  ])(
    'keeps %s to admins: players and organizers see no people and no request is made',
    async (path, endpoint) => {
      for (const role of ['PLAYER', 'ORGANIZER']) {
        signIn(api, me({ role }));
        const { unmount } = renderApp(path);
        expect(
          await screen.findByRole('heading', { name: 'You don’t have permission to do this.' }),
        ).toBeInTheDocument();
        unmount();
      }
      expect(calls('GET', endpoint)).toHaveLength(0);
    },
  );
});
