import { organizerApplicationInputSchema } from '@foodboll/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPLICATION_MESSAGE_MAX } from '../features/organizer/home/ApplyForm';
import {
  apiError,
  chooseLanguageAndRegion,
  gangnam,
  json,
  matchDetail,
  matchSummary,
  me,
  mockApi,
  renderApp,
  seoul,
  setDeviceLanguages,
  signIn,
  type Api,
} from '../test-utils';

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

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const english = (text: string) => ({ text, locale: 'en', isFallback: false });

const bodyOf = (call: { init: RequestInit | undefined } | undefined): unknown =>
  JSON.parse(String(call?.init?.body));

// ---- Organizer home ---------------------------------------------------------------------------

const organized = (id: string, title: string, overrides: Record<string, unknown> = {}) =>
  matchSummary({ id, title: english(title), ...overrides });

const servePage = (items: unknown[], extra: Record<string, unknown> = {}) =>
  json({ items, limit: 20, offset: 0, ...extra });

describe('organizer home', () => {
  beforeEach(() => {
    signIn(api, me({ role: 'ORGANIZER' }));
    api.handlers['/v1/me/organizer-regions'] = () => json({ items: [gangnam] });
  });

  it('offers to announce a match, shows the granted regions and says payments are never the organizer’s job', async () => {
    api.handlers['/v1/me/organized-matches'] = () => servePage([]);
    renderApp('/organizer');

    expect(await screen.findByRole('link', { name: 'Announce a match' })).toHaveAttribute(
      'href',
      '/organizer/matches/new',
    );
    expect(await screen.findByText('Seoul Gangnam-gu')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Payments are checked automatically' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'You never need to check payments. Just announce the match, show up and mark attendance.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Apply for another region' })).toHaveAttribute(
      'href',
      '/organizer/apply',
    );
  });

  it('lists upcoming matches with when, where, how full, and the roster, edit and view actions', async () => {
    api.handlers['/v1/me/organized-matches'] = () =>
      servePage([organized('m1', 'Gangnam Friday futsal')]);
    renderApp('/organizer');

    const card = (await screen.findByRole('heading', { name: 'Gangnam Friday futsal' })).closest(
      'article',
    );
    expect(card).not.toBeNull();
    const scope = within(card as HTMLElement);
    expect(scope.getByText('Sat, May 4')).toBeInTheDocument();
    expect(scope.getByText('22:00–00:00')).toBeInTheDocument();
    expect(scope.getByText('강남 풋살파크 · Seoul Gangnam-gu')).toBeInTheDocument();
    expect(scope.getByText('14/18 joined')).toBeInTheDocument();
    expect(scope.getByRole('link', { name: 'Roster: Gangnam Friday futsal' })).toHaveAttribute(
      'href',
      '/organizer/matches/m1/roster',
    );
    expect(scope.getByRole('link', { name: 'Edit: Gangnam Friday futsal' })).toHaveAttribute(
      'href',
      '/organizer/matches/m1/edit',
    );
    expect(scope.getByRole('link', { name: 'View: Gangnam Friday futsal' })).toHaveAttribute(
      'href',
      '/matches/m1',
    );

    const request = api.find('GET', '/v1/me/organized-matches');
    expect(request?.url.searchParams.get('limit')).toBe('20');
    expect(request?.url.searchParams.get('offset')).toBe('0');
    expect(request?.url.searchParams.get('lang')).toBe('en');
  });

  it('keeps finished matches under Past, where they can still be reviewed but not edited', async () => {
    api.handlers['/v1/me/organized-matches'] = () =>
      servePage([
        organized('m2', 'Next week', { startsAt: at(3 * DAY), endsAt: at(3 * DAY + 2 * HOUR) }),
        organized('m1', 'Old match', {
          startsAt: '2020-01-01T10:00:00.000Z',
          endsAt: '2020-01-01T12:00:00.000Z',
        }),
      ]);
    const user = userEvent.setup();
    renderApp('/organizer');

    expect(await screen.findByRole('heading', { name: 'Next week' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Old match' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Past' }));
    expect(screen.getByRole('heading', { name: 'Old match' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Next week' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Roster: Old match' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View: Old match' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Edit/ })).not.toBeInTheDocument();
  });

  it('shows the soonest upcoming match first although the API lists the newest first', async () => {
    api.handlers['/v1/me/organized-matches'] = () =>
      servePage([
        organized('far', 'In a month', { startsAt: at(30 * DAY), endsAt: at(30 * DAY + HOUR) }),
        organized('near', 'Tomorrow', { startsAt: at(DAY), endsAt: at(DAY + HOUR) }),
      ]);
    renderApp('/organizer');

    await screen.findByRole('heading', { name: 'Tomorrow' });
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Tomorrow',
      'In a month',
    ]);
  });

  it('treats a match in progress as upcoming: marked live, roster open, no editing', async () => {
    api.handlers['/v1/me/organized-matches'] = () =>
      servePage([organized('m1', 'Happening now', { startsAt: at(-HOUR), endsAt: at(HOUR) })]);
    renderApp('/organizer');

    const card = (await screen.findByRole('heading', { name: 'Happening now' })).closest(
      'article',
    ) as HTMLElement;
    expect(within(card).getByText('In progress')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Roster: Happening now' })).toBeInTheDocument();
    expect(within(card).queryByRole('link', { name: /^Edit/ })).not.toBeInTheDocument();
  });

  const upcomingIn = (days: number, title: string) =>
    organized(`m-${title}`, title, { startsAt: at(days * DAY), endsAt: at(days * DAY + HOUR) });
  const finished = (n: number) =>
    organized(`old-${n}`, `Finished ${n}`, {
      startsAt: `2020-01-${String(n).padStart(2, '0')}T10:00:00.000Z`,
      endsAt: `2020-01-${String(n).padStart(2, '0')}T12:00:00.000Z`,
    });
  const offsetsRequested = () =>
    api.calls
      .filter((c) => c.url.pathname === '/api/v1/me/organized-matches')
      .map((c) => c.url.searchParams.get('offset'));

  it('keeps loading until every upcoming match is there, so the soonest one comes first', async () => {
    // Newest first, 20 per page: the matches nearest to today arrive on the second page.
    const far = Array.from({ length: 20 }, (_, i) => upcomingIn(40 - i, `Far ${40 - i}`));
    api.handlers['/v1/me/organized-matches'] = (url) =>
      url.searchParams.get('offset') === '0'
        ? servePage(far)
        : json({ items: [upcomingIn(2, 'Day 2'), upcomingIn(1, 'Day 1')], limit: 20, offset: 20 });
    renderApp('/organizer');

    expect(await screen.findByRole('heading', { name: 'Day 1' })).toBeInTheDocument();
    expect(offsetsRequested()).toEqual(['0', '20']);
    expect(
      screen
        .getAllByRole('heading', { level: 3 })
        .slice(0, 3)
        .map((h) => h.textContent),
    ).toEqual(['Day 1', 'Day 2', 'Far 21']);
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('loads older matches on request under Past', async () => {
    const firstPage = [
      upcomingIn(2, 'Soon'),
      upcomingIn(1, 'Tomorrow'),
      ...Array.from({ length: 18 }, (_, i) => finished(28 - i)),
    ];
    api.handlers['/v1/me/organized-matches'] = (url) =>
      url.searchParams.get('offset') === '0'
        ? servePage(firstPage)
        : json({ items: [finished(1)], limit: 20, offset: 20 });
    const user = userEvent.setup();
    renderApp('/organizer');

    await screen.findByRole('heading', { name: 'Tomorrow' });
    // Finished matches are already there, so nothing more is fetched for the upcoming list.
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Past' }));
    expect(screen.queryByRole('heading', { name: 'Finished 1' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show more' }));

    expect(await screen.findByRole('heading', { name: 'Finished 1' })).toBeInTheDocument();
    expect(offsetsRequested()).toEqual(['0', '20']);
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('says there is nothing upcoming even when older matches are still to be loaded', async () => {
    api.handlers['/v1/me/organized-matches'] = () =>
      servePage(Array.from({ length: 20 }, (_, i) => finished(i + 1)));
    renderApp('/organizer');

    expect(await screen.findByRole('heading', { name: 'No upcoming matches' })).toBeInTheDocument();
    expect(offsetsRequested()).toEqual(['0']);
  });

  it('invites the organizer to announce a first match when there is none', async () => {
    api.handlers['/v1/me/organized-matches'] = () => servePage([]);
    const user = userEvent.setup();
    renderApp('/organizer');

    expect(await screen.findByRole('heading', { name: 'No upcoming matches' })).toBeInTheDocument();
    expect(
      screen.getByText('Announce a match and players can join it right away.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Announce a match' })).toHaveAttribute(
      'href',
      '/organizer/matches/new',
    );

    await user.click(screen.getByRole('tab', { name: 'Past' }));
    expect(screen.getByRole('heading', { name: 'No past matches' })).toBeInTheDocument();
  });

  it('shows a localized error and retries', async () => {
    let failing = true;
    api.handlers['/v1/me/organized-matches'] = () =>
      failing ? apiError('INTERNAL_ERROR', 500) : servePage([organized('m1', 'Back again')]);
    const user = userEvent.setup();
    renderApp('/organizer');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again in a moment.',
    );
    expect(screen.queryByText('ignored')).not.toBeInTheDocument();
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Back again' })).toBeInTheDocument();
  });

  it('sends an organizer without any region to the application instead of offering to announce', async () => {
    api.handlers['/v1/me/organizer-regions'] = () => json({ items: [] });
    api.handlers['/v1/me/organized-matches'] = () => servePage([]);
    renderApp('/organizer');

    expect(
      await screen.findByRole('heading', { name: 'You don’t have a region yet' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Apply to organize' })).toHaveAttribute(
      'href',
      '/organizer/apply',
    );
    expect(screen.queryByRole('link', { name: 'Announce a match' })).not.toBeInTheDocument();
  });

  it('lets admins announce anywhere without any granted region', async () => {
    signIn(api, me({ role: 'ADMIN' }));
    api.handlers['/v1/me/organizer-regions'] = () => json({ items: [] });
    api.handlers['/v1/me/organized-matches'] = () => servePage([]);
    renderApp('/organizer');

    expect(await screen.findByRole('link', { name: 'Announce a match' })).toHaveAttribute(
      'href',
      '/organizer/matches/new',
    );
    expect(
      screen.getByText('As an admin, you can announce matches in every region.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Apply to organize' })).not.toBeInTheDocument();
  });

  it('is closed to players, who are not even asked for organizer data', async () => {
    signIn(api, me({ role: 'PLAYER' }));
    renderApp('/organizer');

    expect(
      await screen.findByRole('heading', { name: 'You don’t have permission to do this.' }),
    ).toBeInTheDocument();
    expect(api.calls.some((c) => c.url.pathname === '/api/v1/me/organized-matches')).toBe(false);
  });
});

// ---- Roster -----------------------------------------------------------------------------------

interface Entry {
  registrationId: string;
  player: {
    id: string;
    displayName: string;
    homeRegion: null;
    level: { level: number; xp: number; xpIntoLevel: number; xpForNextLevel: number };
  };
  attended: boolean | null;
}
const entry = (
  n: number,
  displayName: string,
  attended: boolean | null = null,
  level = 3,
): Entry => ({
  registrationId: `r${n}`,
  player: {
    id: `p${n}`,
    displayName,
    homeRegion: null,
    level: { level, xp: 60, xpIntoLevel: 10, xpForNextLevel: 50 },
  },
  attended,
});

const openMatch = { startsAt: at(-HOUR), endsAt: at(HOUR) };
const group = (name: string) => screen.getByRole('group', { name: `Attendance for ${name}` });
const mark = (user: UserEvent, name: string, label: 'Present' | 'Absent' | 'Not marked') =>
  user.click(within(group(name)).getByRole('button', { name: label }));
const counts = () => screen.getByRole('region', { name: 'Attendance summary' }).textContent;
const putCalls = () =>
  api.calls.filter(
    (c) => c.init?.method === 'PUT' && c.url.pathname === '/api/v1/matches/m1/attendance',
  );

describe('roster', () => {
  let roster: Entry[];
  const serveMatch = (overrides: Record<string, unknown> = openMatch) => {
    api.handlers['/v1/matches/m1'] = () => json(matchDetail({ id: 'm1', ...overrides }));
  };
  const serveRoster = () => {
    api.handlers['/v1/matches/m1/roster'] = () => json({ items: roster });
    api.handlers['/v1/matches/m1/attendance'] = (_url, init) => {
      const { marks } = JSON.parse(String(init?.body)) as {
        marks: { registrationId: string; attended: boolean }[];
      };
      roster = roster.map((e) => {
        const found = marks.find((m) => m.registrationId === e.registrationId);
        return found ? { ...e, attended: found.attended } : e;
      });
      return json({ items: roster });
    };
  };

  beforeEach(() => {
    signIn(api, me({ role: 'ORGANIZER' }));
    roster = [
      entry(1, 'Aziz Karimov'),
      entry(2, 'Dilnoza Rustamova', null, 5),
      entry(3, 'Bobur Aliyev'),
    ];
    serveMatch();
    serveRoster();
  });

  it('shows the match and each confirmed player with level and a link to the profile', async () => {
    const { container } = renderApp('/organizer/matches/m1/roster');

    expect(
      await screen.findByRole('heading', { name: 'Gangnam Friday futsal' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '3 confirmed players' })).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: /Dilnoza Rustamova/ });
    expect(link).toHaveAttribute('href', '/players/p2');
    expect(within(link).getByText('Lv. 5')).toBeInTheDocument();
    expect(counts()).toBe('Present0Absent0Not marked3');
    // The roster never carries payment or contact data, and the page does not invent any.
    expect(container.textContent).not.toMatch(
      /telegram|phone|account number|depositor|receipt|payment/i,
    );
  });

  it('marks players one by one, counts live, and saves only what was decided', async () => {
    const user = userEvent.setup();
    renderApp('/organizer/matches/m1/roster');
    await screen.findByRole('link', { name: /Aziz Karimov/ });

    const save = screen.getByRole('button', { name: 'Save attendance' });
    expect(save).toBeDisabled();
    expect(screen.getByText('No changes yet')).toBeInTheDocument();

    await mark(user, 'Aziz Karimov', 'Present');
    await mark(user, 'Dilnoza Rustamova', 'Absent');
    expect(within(group('Aziz Karimov')).getByRole('button', { name: 'Present' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(counts()).toBe('Present1Absent1Not marked1');
    expect(screen.getByText('2 unsaved changes')).toBeInTheDocument();
    expect(save).toBeEnabled();
    expect(putCalls()).toHaveLength(0);

    await user.click(save);

    await waitFor(() => expect(putCalls()).toHaveLength(1));
    expect(bodyOf(putCalls()[0])).toEqual({
      marks: [
        { registrationId: 'r1', attended: true },
        { registrationId: 'r2', attended: false },
      ],
    });
    expect(await screen.findByText('Attendance saved.')).toBeInTheDocument();
    // Saved state comes back from the server and nothing is left pending.
    await waitFor(() => expect(screen.getByText('No changes yet')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Save attendance' })).toBeDisabled();
    expect(counts()).toBe('Present1Absent1Not marked1');
    expect(
      api.calls.filter((c) => c.url.pathname === '/api/v1/matches/m1/roster').length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('marks everyone present in one tap and still lets the organizer correct a single player', async () => {
    const user = userEvent.setup();
    renderApp('/organizer/matches/m1/roster');
    await screen.findByRole('link', { name: /Aziz Karimov/ });

    await user.click(screen.getByRole('button', { name: 'Mark everyone present' }));
    expect(counts()).toBe('Present3Absent0Not marked0');
    expect(screen.getByText('3 unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark the rest present' })).toBeDisabled();

    await mark(user, 'Bobur Aliyev', 'Absent');
    expect(counts()).toBe('Present2Absent1Not marked0');
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));

    await waitFor(() => expect(putCalls()).toHaveLength(1));
    expect(bodyOf(putCalls()[0])).toEqual({
      marks: [
        { registrationId: 'r1', attended: true },
        { registrationId: 'r2', attended: true },
        { registrationId: 'r3', attended: false },
      ],
    });
  });

  it('only marks the players that are still undecided when asked to mark the rest', async () => {
    const user = userEvent.setup();
    renderApp('/organizer/matches/m1/roster');
    await screen.findByRole('link', { name: /Aziz Karimov/ });

    await mark(user, 'Dilnoza Rustamova', 'Absent');
    await user.click(screen.getByRole('button', { name: 'Mark the rest present' }));

    expect(counts()).toBe('Present2Absent1Not marked0');
    expect(
      within(group('Dilnoza Rustamova')).getByRole('button', { name: 'Absent' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('can take a draft back, and never offers to clear a saved mark', async () => {
    roster = [entry(1, 'Aziz Karimov'), entry(2, 'Dilnoza Rustamova', true)];
    const user = userEvent.setup();
    renderApp('/organizer/matches/m1/roster');
    await screen.findByRole('link', { name: /Aziz Karimov/ });

    // Undecided player: a tap and a tap back leaves nothing to save.
    await mark(user, 'Aziz Karimov', 'Present');
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
    await mark(user, 'Aziz Karimov', 'Not marked');
    expect(screen.getByText('No changes yet')).toBeInTheDocument();

    // Saved mark: shown as such, can only be switched, and switching back drops the draft.
    expect(
      within(group('Dilnoza Rustamova')).getByRole('button', { name: 'Present' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      within(group('Dilnoza Rustamova')).getByRole('button', { name: 'Not marked' }),
    ).toBeDisabled();
    expect(screen.getByText('A saved mark can be changed but not removed.')).toBeInTheDocument();
    await mark(user, 'Dilnoza Rustamova', 'Absent');
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
    await mark(user, 'Dilnoza Rustamova', 'Present');
    expect(screen.getByText('No changes yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save attendance' })).toBeDisabled();
  });

  it('does not resend marks that are already saved', async () => {
    roster = [
      entry(1, 'Aziz Karimov'),
      entry(2, 'Dilnoza Rustamova', true),
      entry(3, 'Bobur Aliyev', false),
    ];
    const user = userEvent.setup();
    renderApp('/organizer/matches/m1/roster');
    await screen.findByRole('link', { name: /Aziz Karimov/ });

    await mark(user, 'Aziz Karimov', 'Present');
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));

    await waitFor(() => expect(putCalls()).toHaveLength(1));
    expect(bodyOf(putCalls()[0])).toEqual({ marks: [{ registrationId: 'r1', attended: true }] });
  });

  it('asks the browser to confirm leaving while there are unsaved marks, and not otherwise', async () => {
    const user = userEvent.setup();
    renderApp('/organizer/matches/m1/roster');
    await screen.findByRole('link', { name: /Aziz Karimov/ });
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(leave()).toBe(false);
    await mark(user, 'Aziz Karimov', 'Present');
    expect(leave()).toBe(true);
    await mark(user, 'Aziz Karimov', 'Not marked');
    expect(leave()).toBe(false);
  });

  it('explains that attendance opens at kick-off and keeps every control disabled before that', async () => {
    serveMatch({ startsAt: at(DAY), endsAt: at(DAY + 2 * HOUR) });
    renderApp('/organizer/matches/m1/roster');

    expect(
      await screen.findByText('You can mark attendance once the match has started.'),
    ).toBeInTheDocument();
    expect(within(group('Aziz Karimov')).getByRole('button', { name: 'Present' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mark everyone present' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save attendance' })).not.toBeInTheDocument();
    expect(putCalls()).toHaveLength(0);
  });

  it('is read-only once the two-week window after the match is over', async () => {
    roster = [entry(1, 'Aziz Karimov', true)];
    serveMatch({ startsAt: at(-21 * DAY), endsAt: at(-21 * DAY + 2 * HOUR) });
    renderApp('/organizer/matches/m1/roster');

    expect(
      await screen.findByText(
        'The attendance window has closed. Marks can be changed for 14 days after the match ends.',
      ),
    ).toBeInTheDocument();
    expect(within(group('Aziz Karimov')).getByRole('button', { name: 'Absent' })).toBeDisabled();
    expect(within(group('Aziz Karimov')).getByRole('button', { name: 'Present' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('button', { name: 'Save attendance' })).not.toBeInTheDocument();
  });

  it('keeps the organizer’s marks, explains the failure in their language and reloads the roster', async () => {
    let failing = true;
    api.handlers['/v1/matches/m1/attendance'] = (_url, init) => {
      if (failing) return apiError('MATCH_NOT_STARTED', 409);
      const { marks } = JSON.parse(String(init?.body)) as {
        marks: { registrationId: string; attended: boolean }[];
      };
      roster = roster.map((e) => ({
        ...e,
        attended: marks.find((m) => m.registrationId === e.registrationId)?.attended ?? e.attended,
      }));
      return json({ items: roster });
    };
    const user = userEvent.setup();
    renderApp('/organizer/matches/m1/roster');
    await screen.findByRole('link', { name: /Aziz Karimov/ });
    const rosterReads = () =>
      api.calls.filter((c) => c.url.pathname === '/api/v1/matches/m1/roster').length;
    const readsBefore = rosterReads();

    await mark(user, 'Aziz Karimov', 'Present');
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This match hasn’t started yet.');
    expect(screen.queryByText('ignored')).not.toBeInTheDocument();
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
    await waitFor(() => expect(rosterReads()).toBeGreaterThan(readsBefore));

    failing = false;
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));
    expect(await screen.findByText('Attendance saved.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('says so when nobody is confirmed yet', async () => {
    roster = [];
    renderApp('/organizer/matches/m1/roster');
    expect(
      await screen.findByRole('heading', { name: 'No confirmed players yet' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save attendance' })).not.toBeInTheDocument();
  });

  it('tells an organizer that someone else’s match is not theirs, without a pointless retry', async () => {
    api.handlers['/v1/matches/m1/roster'] = () => apiError('FORBIDDEN', 403);
    renderApp('/organizer/matches/m1/roster');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You don’t have permission to do this.',
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('reports a match that does not exist', async () => {
    api.handlers['/v1/matches/missing'] = () => apiError('MATCH_NOT_FOUND', 404);
    renderApp('/organizer/matches/missing/roster');
    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t find this match.');
  });

  it('is closed to players', async () => {
    signIn(api, me({ role: 'PLAYER' }));
    renderApp('/organizer/matches/m1/roster');
    expect(
      await screen.findByRole('heading', { name: 'You don’t have permission to do this.' }),
    ).toBeInTheDocument();
    expect(api.calls.some((c) => c.url.pathname === '/api/v1/matches/m1/roster')).toBe(false);
  });
});

// ---- Become an organizer ----------------------------------------------------------------------

const node = (
  region: typeof seoul | typeof gangnam,
  upcomingMatches: number,
  children: unknown[] = [],
) => ({
  id: region.id,
  code: region.code,
  name: region.name,
  level: region.level,
  upcomingMatches,
  children,
});
const regionTree = {
  items: [node(seoul, 5, [node(gangnam, 2)])],
};

const application = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1',
  status: 'PENDING',
  region: gangnam,
  message: null,
  createdAt: '2030-05-01T00:00:00.000Z',
  reviewedAt: null,
  applicant: { id: 'u1', displayName: 'Aziz' },
  ...overrides,
});

async function chooseRegion(user: UserEvent, trigger = 'Region Choose a region') {
  await user.click(await screen.findByRole('button', { name: trigger }));
  const dialog = await screen.findByRole('dialog', { name: 'Choose region' });
  await user.type(within(dialog).getByRole('searchbox', { name: 'Search regions' }), 'Gangnam');
  await user.click(await within(dialog).findByRole('button', { name: /Gangnam-gu/ }));
}

describe('become an organizer', () => {
  let applications: unknown[];
  beforeEach(() => {
    signIn(api, me({ role: 'PLAYER' }));
    applications = [];
    api.handlers['/v1/regions'] = () => json(regionTree);
    api.handlers['/v1/me/organizer-applications'] = () => json({ items: applications });
    api.handlers['/v1/organizer-applications'] = (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { message: string | null };
      const created = application({ id: 'new', message: body.message });
      applications = [created, ...applications];
      return json(created, 201);
    };
  });

  it('explains in a few lines how it works and that payments are not the organizer’s job', async () => {
    renderApp('/organizer/apply');
    expect(
      await screen.findByText(
        'Anyone in the community can organize matches in their own city or district.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('An admin reviews every application. We’ll notify you of the result.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Payments are checked automatically, so you only announce matches and mark attendance.',
      ),
    ).toBeInTheDocument();
  });

  it('sends the chosen region and the message, then shows the new application and resets the form', async () => {
    const user = userEvent.setup();
    renderApp('/organizer/apply');
    expect(await screen.findByText('You haven’t applied yet.')).toBeInTheDocument();

    await chooseRegion(user);
    expect(screen.getByRole('button', { name: 'Region Seoul Gangnam-gu' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('About you (optional)'), '  I play every Friday  ');
    await user.click(screen.getByRole('button', { name: 'Submit application' }));

    await waitFor(() => expect(api.find('POST', '/v1/organizer-applications')).toBeDefined());
    expect(bodyOf(api.find('POST', '/v1/organizer-applications'))).toEqual({
      regionCode: 'seoul-gangnam',
      message: 'I play every Friday',
    });
    expect(await screen.findByText('Application sent.')).toBeInTheDocument();
    expect(await screen.findByText('I play every Friday')).toBeInTheDocument();
    expect(screen.getByText('Under review')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Region Choose a region' })).toBeInTheDocument();
    expect(screen.getByLabelText('About you (optional)')).toHaveValue('');
    expect(
      api.calls.filter((c) => c.url.pathname === '/api/v1/me/organizer-applications').length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('sends no message at all when the box was left empty', async () => {
    const user = userEvent.setup();
    renderApp('/organizer/apply');
    await chooseRegion(user);
    await user.click(screen.getByRole('button', { name: 'Submit application' }));

    await waitFor(() => expect(api.find('POST', '/v1/organizer-applications')).toBeDefined());
    expect(bodyOf(api.find('POST', '/v1/organizer-applications'))).toEqual({
      regionCode: 'seoul-gangnam',
      message: null,
    });
  });

  it('asks for a region before sending anything, and drops the complaint once one is chosen', async () => {
    const user = userEvent.setup();
    renderApp('/organizer/apply');
    await user.click(await screen.findByRole('button', { name: 'Submit application' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Choose the region you want to organize in.',
    );
    expect(
      screen.getByRole('button', { name: 'Region Choose a region' }),
    ).toHaveAccessibleDescription('Choose the region you want to organize in.');
    expect(api.find('POST', '/v1/organizer-applications')).toBeUndefined();

    await chooseRegion(user);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the message within the limit the contract allows', async () => {
    expect(
      organizerApplicationInputSchema.safeParse({
        regionCode: 'seoul',
        message: 'x'.repeat(APPLICATION_MESSAGE_MAX),
      }).success,
    ).toBe(true);
    expect(
      organizerApplicationInputSchema.safeParse({
        regionCode: 'seoul',
        message: 'x'.repeat(APPLICATION_MESSAGE_MAX + 1),
      }).success,
    ).toBe(false);

    const user = userEvent.setup();
    renderApp('/organizer/apply');
    const box = await screen.findByLabelText('About you (optional)');
    expect(box).toHaveAttribute('maxlength', String(APPLICATION_MESSAGE_MAX));
    await user.type(box, 'Hello');
    expect(screen.getByText(`5/${APPLICATION_MESSAGE_MAX}`)).toBeInTheDocument();

    // A paste or autofill can still get past maxlength: the shared schema decides, not the attribute.
    await chooseRegion(user);
    fireEvent.change(box, { target: { value: 'x'.repeat(APPLICATION_MESSAGE_MAX + 1) } });
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    expect(
      await screen.findByText(`Enter ${APPLICATION_MESSAGE_MAX} characters or fewer.`),
    ).toBeInTheDocument();
    expect(api.find('POST', '/v1/organizer-applications')).toBeUndefined();
  });

  it.each([
    [
      'INVALID_STATE',
      409,
      'You’ve already applied for this region, you can already announce matches there, or you have too many open applications.',
    ],
    ['REGION_NOT_FOUND', 404, 'We couldn’t find this region.'],
    ['FORBIDDEN', 403, 'You don’t have permission to do this.'],
  ])(
    'explains a %s answer in the user’s language and lets them try again',
    async (code, status, text) => {
      let failing = true;
      const accept = api.handlers['/v1/organizer-applications'];
      api.handlers['/v1/organizer-applications'] = (url, init) =>
        failing ? apiError(code, status) : (accept?.(url, init) as Response);
      const user = userEvent.setup();
      renderApp('/organizer/apply');
      await chooseRegion(user);
      await user.click(screen.getByRole('button', { name: 'Submit application' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(text);
      expect(screen.queryByText('ignored')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Region Seoul Gangnam-gu' })).toBeInTheDocument();

      // Editing clears the stale error; sending again works once the cause is gone.
      failing = false;
      await user.type(screen.getByLabelText('About you (optional)'), 'x');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Submit application' }));
      expect(await screen.findByText('Application sent.')).toBeInTheDocument();
    },
  );

  it('lists my applications with region, message, status and dates', async () => {
    applications = [
      application({
        id: 'a3',
        status: 'REJECTED',
        createdAt: '2030-05-03T00:00:00.000Z',
        reviewedAt: '2030-05-06T00:00:00.000Z',
        message: 'Second try',
      }),
      application({
        id: 'a2',
        status: 'APPROVED',
        region: { ...seoul, parent: null },
        createdAt: '2030-04-01T00:00:00.000Z',
        reviewedAt: '2030-04-02T00:00:00.000Z',
      }),
      application({ id: 'a1', status: 'PENDING', message: 'I play every Friday' }),
    ];
    renderApp('/organizer/apply');

    await screen.findByText('Second try');
    const rows = screen
      .getAllByRole('listitem')
      .filter((li) => li.classList.contains('application'));
    expect(rows).toHaveLength(3);
    expect(within(rows[0] as HTMLElement).getByText('Not approved')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('Seoul Gangnam-gu')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('Second try')).toBeInTheDocument();
    expect(
      within(rows[0] as HTMLElement).getByText('Applied May 3, 2030 · Reviewed May 6, 2030'),
    ).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('Approved')).toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).getByRole('heading', { name: 'Seoul' }),
    ).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('Under review')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('Applied May 1, 2030')).toBeInTheDocument();
  });

  it('shows applicant text as plain text', async () => {
    applications = [application({ message: '<img src=x onerror=alert(1)>' })];
    const { container } = renderApp('/organizer/apply');
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows a localized error for the list and retries', async () => {
    let failing = true;
    api.handlers['/v1/me/organizer-applications'] = () =>
      failing ? apiError('INTERNAL_ERROR', 500) : json({ items: [application()] });
    const user = userEvent.setup();
    renderApp('/organizer/apply');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again in a moment.',
    );
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Under review')).toBeInTheDocument();
  });

  it('lets organizers apply for further regions', async () => {
    signIn(api, me({ role: 'ORGANIZER' }));
    renderApp('/organizer/apply');
    expect(await screen.findByRole('button', { name: 'Submit application' })).toBeEnabled();
  });

  it('spares admins an application they could never need', async () => {
    signIn(api, me({ role: 'ADMIN' }));
    renderApp('/organizer/apply');

    expect(
      await screen.findByText(
        'Admins can announce matches in every region, so there’s nothing to apply for.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit application' })).not.toBeInTheDocument();
  });

  it('asks a signed-out visitor to log in first', async () => {
    window.localStorage.removeItem('foodboll.accessToken');
    renderApp('/organizer/apply');
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument();
    expect(api.calls.some((c) => c.url.pathname === '/api/v1/me/organizer-applications')).toBe(
      false,
    );
  });
});
