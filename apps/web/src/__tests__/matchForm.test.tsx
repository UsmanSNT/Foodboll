import { focusManager, QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  chooseLanguageAndRegion,
  json,
  matchDetail,
  me,
  mockApi,
  renderApp,
  setDeviceLanguages,
  signIn,
  type Api,
} from '../test-utils';

// The screen after saving is not under test: a marker shows that the form navigated to it.
vi.mock('../features/organizer/OrganizerHomePage', () => ({
  OrganizerHomePage: () => createElement('p', null, 'Organizer home marker'),
}));

const localized = (text: string) => ({ text, locale: 'en', isFallback: false });
const leaf = (code: string, text: string) => ({
  id: `id-${code}`,
  code,
  name: localized(text),
  level: 2,
  upcomingMatches: 0,
  children: [],
});
const province = (code: string, text: string, children: ReturnType<typeof leaf>[] = []) => ({
  id: `id-${code}`,
  code,
  name: localized(text),
  level: 1,
  upcomingMatches: 0,
  children,
});
const regionTree = {
  items: [
    province('seoul', 'Seoul', [
      leaf('seoul-gangnam', 'Gangnam-gu'),
      leaf('seoul-mapo', 'Mapo-gu'),
    ]),
    province('gyeonggi', 'Gyeonggi', [
      leaf('gyeonggi-suwon', 'Suwon'),
      leaf('gyeonggi-ansan', 'Ansan'),
    ]),
    province('busan', 'Busan', [leaf('busan-haeundae', 'Haeundae-gu')]),
  ],
};
const granted = (code: string, text: string, level = 1) => ({
  id: `id-${code}`,
  code,
  name: localized(text),
  level,
  parent: null,
});

const MAPO = granted('seoul-mapo', 'Mapo-gu', 2);
const GYEONGGI = granted('gyeonggi', 'Gyeonggi');

let api: Api;
beforeEach(() => {
  api = mockApi();
  setDeviceLanguages(['en-US']);
  chooseLanguageAndRegion('en', 'all');
  api.handlers['/v1/regions'] = () => json(regionTree);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function openAs(
  role: 'ORGANIZER' | 'ADMIN' | 'PLAYER',
  regions: unknown[] = [MAPO],
  account: Record<string, unknown> = {},
) {
  signIn(api, me({ role, ...account }));
  api.handlers['/v1/me/organizer-regions'] = () => json({ items: regions });
}

const bodyOf = (method: string, path: string) =>
  JSON.parse(String(api.find(method, path)?.init?.body)) as Record<string, unknown>;
const regionButton = () => screen.getByRole('button', { name: /^Region/ });
const submitButton = (name = 'Announce match') => screen.getByRole('button', { name });

/** Typed values for the fields every announcement needs, in Korean time. */
async function fillMinimum(user: UserEvent) {
  await user.type(screen.getByLabelText('Venue name'), '마포 풋살장');
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2030-05-04' } });
  fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '19:00' } });
  fireEvent.change(screen.getByLabelText('End time'), { target: { value: '21:00' } });
  await user.type(screen.getByLabelText('Title'), 'Mapo Saturday futsal');
}

async function pickRegion(user: UserEvent, name: string) {
  await user.click(regionButton());
  const dialog = await screen.findByRole('dialog', { name: 'Choose region' });
  await user.click(within(dialog).getByRole('button', { name }));
}

describe('announcing a match', () => {
  it('sends the exact request for a Korean original with an Uzbek translation, then returns to the organizer home', async () => {
    openAs('ORGANIZER', [GYEONGGI, MAPO]);
    api.handlers['/v1/matches'] = () => json(matchDetail(), 201);
    const user = userEvent.setup();
    renderApp('/organizer/matches/new');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Create match' }),
    ).toBeInTheDocument();
    await screen.findByLabelText('Venue name');
    await pickRegion(user, 'Ansan');
    expect(regionButton()).toHaveAccessibleName('Region Gyeonggi Ansan');

    await user.click(screen.getByRole('radio', { name: '한국어' }));
    await user.type(screen.getByLabelText('Venue name'), '안산 풋살파크');
    await user.type(screen.getByLabelText('Address (optional)'), '경기도 안산시 단원구 1');
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2030-05-04' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '22:00' } });
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '00:00' } });
    expect(screen.getByText('Sat, May 4 · 22:00–00:00 · Korea time')).toBeInTheDocument();
    expect(screen.getByText('Lasts 2 h · Ends the next day (Sun, May 5)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Increase: Players per side' }));
    expect(screen.getByRole('spinbutton', { name: 'Players per side' })).toHaveValue(7);
    expect(screen.getByRole('spinbutton', { name: 'Max players' })).toHaveValue(14);

    await user.type(screen.getByLabelText('Title'), '안산 금요 풋살');
    await user.type(screen.getByLabelText('About this match'), '  모든 실력 환영  ');
    await user.click(screen.getByRole('tab', { name: /O‘zbekcha/ }));
    await user.type(screen.getByLabelText('Title'), 'Ansan juma futzal');
    expect(
      screen.getByText('Readers whose language is left empty will see the original text (한국어).'),
    ).toBeInTheDocument();

    await user.click(submitButton());

    await waitFor(() => expect(api.find('POST', '/v1/matches')).toBeDefined());
    expect(bodyOf('POST', '/v1/matches')).toEqual({
      sourceLanguage: 'ko',
      regionCode: 'gyeonggi-ansan',
      startsAt: '2030-05-04T22:00:00+09:00',
      endsAt: '2030-05-05T00:00:00+09:00',
      venueName: '안산 풋살파크',
      venueAddress: '경기도 안산시 단원구 1',
      playersPerSide: 7,
      maxPlayers: 14,
      translations: {
        ko: {
          title: '안산 금요 풋살',
          description: '모든 실력 환영',
          rules: null,
          locationInstructions: null,
          equipmentRequirements: null,
          cancellationPolicy: null,
        },
        uz: {
          title: 'Ansan juma futzal',
          description: null,
          rules: null,
          locationInstructions: null,
          equipmentRequirements: null,
          cancellationPolicy: null,
        },
      },
    });
    expect(await screen.findByText('Organizer home marker')).toBeInTheDocument();
    expect(screen.getByText('Match created')).toBeInTheDocument();
  });

  it('tells organizers the fee is set by the platform, shows no amount and sends none', async () => {
    openAs('ORGANIZER');
    api.handlers['/v1/matches'] = () => json(matchDetail(), 201);
    const user = userEvent.setup();
    renderApp('/organizer/matches/new');
    await screen.findByLabelText('Venue name');

    expect(
      screen.getByText(/The entry fee is set by the platform and is the same for everyone/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/₩/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/fee|price/i)).not.toBeInTheDocument();

    await fillMinimum(user);
    await user.click(submitButton());
    await waitFor(() => expect(api.find('POST', '/v1/matches')).toBeDefined());
    expect(bodyOf('POST', '/v1/matches')).not.toHaveProperty('feeKrw');
  });

  it('starts with the organizer’s language as the original and with their only region', async () => {
    openAs('ORGANIZER', [MAPO], { preferredLanguage: 'uz', effectiveLanguage: 'uz' });
    chooseLanguageAndRegion('uz', 'all');
    renderApp('/organizer/matches/new');
    await screen.findByLabelText('Maydon nomi');

    expect(screen.getByRole('radio', { name: 'O‘zbekcha' })).toBeChecked();
    expect(screen.getByRole('tab', { name: /O‘zbekcha/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: /^Hudud/ })).toHaveAccessibleName(
      'Hudud Seoul Mapo-gu',
    );
  });

  it('sends only the languages that have text and defaults capacity to two full sides', async () => {
    openAs('ORGANIZER');
    api.handlers['/v1/matches'] = () => json(matchDetail(), 201);
    const user = userEvent.setup();
    renderApp('/organizer/matches/new');
    await screen.findByLabelText('Venue name');
    await fillMinimum(user);

    await user.click(submitButton());
    await waitFor(() => expect(api.find('POST', '/v1/matches')).toBeDefined());
    const body = bodyOf('POST', '/v1/matches') as {
      translations: Record<string, unknown>;
      maxPlayers: number;
      playersPerSide: number;
      sourceLanguage: string;
    };
    expect(Object.keys(body.translations)).toEqual(['en']);
    expect(body).toMatchObject({
      sourceLanguage: 'en',
      playersPerSide: 6,
      maxPlayers: 12,
      regionCode: 'seoul-mapo',
    });
  });
});

describe('regions', () => {
  it('offers only the regions granted to the organizer: a province with its districts, a district alone', async () => {
    openAs('ORGANIZER', [GYEONGGI, MAPO]);
    const user = userEvent.setup();
    renderApp('/organizer/matches/new');
    await screen.findByLabelText('Venue name');

    await user.click(regionButton());
    const dialog = await screen.findByRole('dialog', { name: 'Choose region' });
    for (const name of ['All of Gyeonggi', 'Suwon', 'Ansan', 'Mapo-gu']) {
      expect(within(dialog).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(within(dialog).getByRole('heading', { name: 'Gyeonggi' })).toBeInTheDocument();
    for (const missing of ['Gangnam-gu', 'All of Seoul', 'Busan', 'Haeundae-gu']) {
      expect(within(dialog).queryByText(missing)).not.toBeInTheDocument();
    }
  });

  it('searches the offered regions and chooses a whole province', async () => {
    openAs('ORGANIZER', [GYEONGGI, MAPO]);
    const user = userEvent.setup();
    renderApp('/organizer/matches/new');
    await screen.findByLabelText('Venue name');

    await user.click(regionButton());
    const dialog = await screen.findByRole('dialog', { name: 'Choose region' });
    const search = within(dialog).getByRole('searchbox', { name: 'Search regions' });
    await user.type(search, 'suw');
    expect(within(dialog).getByRole('button', { name: 'Suwon' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Ansan' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Mapo-gu' })).not.toBeInTheDocument();

    // Gangnam exists in Seoul but was not granted: searching for it finds nothing.
    await user.clear(search);
    await user.type(search, 'gangnam');
    expect(within(dialog).getByText('No matching regions.')).toBeInTheDocument();

    await user.clear(search);
    await user.click(within(dialog).getByRole('button', { name: 'All of Gyeonggi' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(regionButton()).toHaveAccessibleName('Region Gyeonggi');
  });

  it('lets an admin announce anywhere without asking for organizer regions', async () => {
    openAs('ADMIN', []);
    const user = userEvent.setup();
    renderApp('/organizer/matches/new');
    await screen.findByLabelText('Venue name');

    await user.click(regionButton());
    const dialog = await screen.findByRole('dialog', { name: 'Choose region' });
    for (const name of [
      'All of Seoul',
      'Gangnam-gu',
      'All of Gyeonggi',
      'All of Busan',
      'Haeundae-gu',
    ]) {
      expect(within(dialog).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(api.find('GET', '/v1/me/organizer-regions')).toBeUndefined();
  });

  it('points an organizer without any region to the application page', async () => {
    openAs('ORGANIZER', []);
    renderApp('/organizer/matches/new');

    expect(
      await screen.findByRole('heading', { name: 'You can’t announce matches in any region yet' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Apply to organize' })).toHaveAttribute(
      'href',
      '/organizer/apply',
    );
    expect(screen.queryByLabelText('Venue name')).not.toBeInTheDocument();
  });
});

describe('validation', () => {
  it('shows a localized message on every field that needs one, sends nothing and focuses the first', async () => {
    openAs('ORGANIZER', [GYEONGGI, MAPO]);
    const user = userEvent.setup();
    renderApp('/organizer/matches/new');
    await screen.findByLabelText('Venue name');

    await user.click(submitButton());

    expect(api.find('POST', '/v1/matches')).toBeUndefined();
    expect(screen.getAllByText('This field is required.')).toHaveLength(5);
    expect(screen.getByText('Add a title in the original language.')).toBeInTheDocument();
    // The region button is the first thing on the screen that needs attention.
    expect(regionButton()).toHaveFocus();
    expect(regionButton()).toHaveAccessibleDescription('This field is required.');

    // Errors follow the fields from then on; focus goes to the next problem on the next attempt.
    await pickRegion(user, 'Ansan');
    expect(screen.getAllByText('This field is required.')).toHaveLength(4);
    await user.click(submitButton());
    expect(screen.getByLabelText('Venue name')).toHaveFocus();
    expect(screen.getByLabelText('Venue name')).toBeInvalid();
    expect(screen.getByLabelText('Venue name')).toHaveAccessibleDescription(
      /This field is required\./,
    );
  });

  it('switches to the language tab with the problem and focuses its field', async () => {
    openAs('ORGANIZER');
    const user = userEvent.setup();
    renderApp('/organizer/matches/new');
    await screen.findByLabelText('Venue name');
    await fillMinimum(user);

    await user.click(screen.getByRole('tab', { name: /O‘zbekcha/ }));
    await user.type(screen.getByLabelText('Rules'), 'Hakam bo‘lmaydi');
    // Back on the original: the Uzbek tab warns that it has text but no title.
    await user.click(screen.getByRole('tab', { name: /English/ }));
    expect(screen.getByRole('tab', { name: 'O‘zbekcha Title missing' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'English Filled' })).toBeInTheDocument();

    await user.click(submitButton());

    expect(api.find('POST', '/v1/matches')).toBeUndefined();
    expect(screen.getByRole('tab', { name: /O‘zbekcha/ })).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByText('Add a title, or clear everything in this language.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveFocus();
  });

  it('requires the title of the original language when only another language is written', async () => {
    openAs('ORGANIZER');
    const user = userEvent.setup();
    renderApp('/organizer/matches/new');
    await screen.findByLabelText('Venue name');
    await fillMinimum(user);
    await user.clear(screen.getByLabelText('Title'));
    await user.click(screen.getByRole('tab', { name: /한국어/ }));
    await user.type(screen.getByLabelText('Title'), '마포 토요 풋살');

    await user.click(submitButton());
    expect(api.find('POST', '/v1/matches')).toBeUndefined();
    // Korean is filled, but the original is English and its title is empty.
    await user.click(screen.getByRole('tab', { name: /English/ }));
    expect(screen.getByText('Add a title in the original language.')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '한국어' }));
    await user.click(submitButton());
    await waitFor(() => expect(api.find('POST', '/v1/matches')).toBeDefined());
    expect(bodyOf('POST', '/v1/matches')).toMatchObject({ sourceLanguage: 'ko' });
  });

  it('counts the characters left and flags text that is too long', async () => {
    openAs('ORGANIZER');
    const user = userEvent.setup();
    renderApp('/organizer/matches/new');
    await screen.findByLabelText('Venue name');
    await fillMinimum(user);

    const description = screen.getByLabelText('About this match');
    expect(description).toHaveAccessibleDescription(/5,000 characters left/);
    await user.type(description, 'Hello');
    expect(description).toHaveAccessibleDescription(/4,995 characters left/);

    fireEvent.change(description, { target: { value: 'a'.repeat(5001) } });
    expect(description).toHaveAccessibleDescription(/1 character over/);
    await user.click(submitButton());

    expect(api.find('POST', '/v1/matches')).toBeUndefined();
    expect(description).toBeInvalid();
    expect(description).toHaveAccessibleDescription(/Enter 5000 characters or fewer\./);
    expect(description).toHaveFocus();
  });

  it('checks when the match is held: the start must be ahead and the match at most 12 hours', async () => {
    openAs('ORGANIZER');
    const user = userEvent.setup();
    renderApp('/organizer/matches/new');
    await screen.findByLabelText('Venue name');
    await fillMinimum(user);

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2020-01-01' } });
    await user.click(submitButton());
    expect(
      screen.getByText('The match must start in the future (Korea time).'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Date')).toHaveFocus();

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2030-05-04' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '08:00' } });
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '20:30' } });
    expect(screen.getByText('A match can last up to 12 hours.')).toBeInTheDocument();
    expect(screen.getByLabelText('End time')).toBeInvalid();

    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '19:59' } });
    expect(screen.queryByText('A match can last up to 12 hours.')).not.toBeInTheDocument();
    expect(screen.getByText('Lasts 11 h 59 min')).toBeInTheDocument();
    expect(api.find('POST', '/v1/matches')).toBeUndefined();
  });

  it('shows the schedule in Korean time and builds the request in it whatever the device’s time zone', async () => {
    const original = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(new Date('2030-05-04T00:00:00Z').getTimezoneOffset()).toBe(420);
      openAs('ORGANIZER');
      api.handlers['/v1/matches'] = () => json(matchDetail(), 201);
      const user = userEvent.setup();
      renderApp('/organizer/matches/new');
      await screen.findByLabelText('Venue name');
      await fillMinimum(user);
      fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '00:30' } });
      fireEvent.change(screen.getByLabelText('End time'), { target: { value: '02:00' } });
      expect(screen.getByText('Sat, May 4 · 00:30–02:00 · Korea time')).toBeInTheDocument();

      await user.click(submitButton());
      await waitFor(() => expect(api.find('POST', '/v1/matches')).toBeDefined());
      expect(bodyOf('POST', '/v1/matches')).toMatchObject({
        startsAt: '2030-05-04T00:30:00+09:00',
        endsAt: '2030-05-04T02:00:00+09:00',
      });
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe('capacity', () => {
  it('follows the team size until it is set by hand, and never drops below two full sides', async () => {
    openAs('ORGANIZER');
    api.handlers['/v1/matches'] = () => json(matchDetail(), 201);
    const user = userEvent.setup();
    renderApp('/organizer/matches/new');
    await screen.findByLabelText('Venue name');
    await fillMinimum(user);
    const perSide = screen.getByRole('spinbutton', { name: 'Players per side' });
    const max = screen.getByRole('spinbutton', { name: 'Max players' });

    await user.click(screen.getByRole('button', { name: 'Increase: Players per side' }));
    expect(max).toHaveValue(14);

    await user.clear(max);
    await user.type(max, '99');
    await user.tab();
    expect(max).toHaveValue(60);
    await user.clear(max);
    await user.type(max, '5');
    await user.tab();
    expect(max).toHaveValue(14);

    await user.click(screen.getByRole('button', { name: 'Increase: Max players' }));
    await user.click(screen.getByRole('button', { name: 'Increase: Players per side' }));
    expect(perSide).toHaveValue(8);
    expect(max).toHaveValue(16);
    await user.click(screen.getByRole('button', { name: 'Decrease: Players per side' }));
    expect(max).toHaveValue(16);

    await user.clear(perSide);
    await user.type(perSide, '1');
    await user.tab();
    expect(perSide).toHaveValue(3);
    await user.click(submitButton());
    await waitFor(() => expect(api.find('POST', '/v1/matches')).toBeDefined());
    expect(bodyOf('POST', '/v1/matches')).toMatchObject({ playersPerSide: 3, maxPlayers: 16 });
  });
});

describe('languages', () => {
  it('moves between languages with the arrow keys and clears a language it no longer needs', async () => {
    openAs('ORGANIZER');
    const user = userEvent.setup();
    renderApp('/organizer/matches/new');
    await screen.findByLabelText('Venue name');

    const english = screen.getByRole('tab', { name: /English/ });
    english.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /한국어/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /한국어/ })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /O‘zbekcha/ })).toHaveFocus();
    await user.keyboard('{End}');
    expect(english).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('tab', { name: /한국어/ }));
    expect(screen.queryByRole('button', { name: 'Clear this language' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Title'), '마포 풋살');
    await user.type(screen.getByLabelText('Rules'), '슬라이딩 금지');
    expect(screen.getByRole('tab', { name: '한국어 Filled' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear this language' }));
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.getByLabelText('Rules')).toHaveValue('');
    expect(screen.getByRole('tab', { name: '한국어 Empty' })).toBeInTheDocument();
  });

  it('keeps the original’s tab and the explanation in step with the chosen original language', async () => {
    openAs('ORGANIZER');
    const user = userEvent.setup();
    renderApp('/organizer/matches/new');
    await screen.findByLabelText('Venue name');

    expect(screen.getByText('Original')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'O‘zbekcha' }));
    expect(screen.getByRole('tab', { name: /O‘zbekcha/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Original')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Readers whose language is left empty will see the original text (O‘zbekcha).',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /한국어/ }));
    expect(screen.getByText('Translation')).toBeInTheDocument();
  });
});

describe('server errors', () => {
  it.each([
    ['REGION_FORBIDDEN', 403, 'You can’t create matches in this region.'],
    [
      'CAPACITY_BELOW_REGISTRATIONS',
      409,
      'Max players can’t be lower than the number of current registrations.',
    ],
    ['MATCH_STARTED', 409, 'This match has already started.'],
    ['SOURCE_TRANSLATION_REQUIRED', 422, 'Please add the text in the original (default) language.'],
    ['INTERNAL_ERROR', 500, 'Something went wrong. Please try again in a moment.'],
    ['NETWORK_ERROR', 500, 'Check your network connection and try again.'],
  ])(
    'shows %s in the user’s language, never the server text, and keeps what was typed',
    async (code, status, message) => {
      openAs('ORGANIZER');
      api.handlers['/v1/matches'] = () => apiError(code, status);
      const user = userEvent.setup();
      renderApp('/organizer/matches/new');
      await screen.findByLabelText('Venue name');
      await fillMinimum(user);

      await user.click(submitButton());

      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(screen.queryByText('ignored')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Venue name')).toHaveValue('마포 풋살장');
      expect(submitButton()).toBeEnabled();
      expect(screen.queryByText('Organizer home marker')).not.toBeInTheDocument();
    },
  );

  it('retires the error as soon as the organizer changes something', async () => {
    openAs('ORGANIZER', [GYEONGGI, MAPO]);
    api.handlers['/v1/matches'] = (_url, init) =>
      JSON.parse(String(init?.body)).regionCode === 'seoul-mapo'
        ? apiError('REGION_FORBIDDEN', 403)
        : json(matchDetail(), 201);
    const user = userEvent.setup();
    renderApp('/organizer/matches/new');
    await screen.findByLabelText('Venue name');
    await pickRegion(user, 'Mapo-gu');
    await fillMinimum(user);

    await user.click(submitButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You can’t create matches in this region.',
    );
    await pickRegion(user, 'Ansan');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await user.click(submitButton());
    expect(await screen.findByText('Organizer home marker')).toBeInTheDocument();
  });

  it('can be sent again after a failure', async () => {
    openAs('ORGANIZER');
    let attempts = 0;
    api.handlers['/v1/matches'] = () =>
      ++attempts === 1 ? apiError('INTERNAL_ERROR', 500) : json(matchDetail(), 201);
    const user = userEvent.setup();
    renderApp('/organizer/matches/new');
    await screen.findByLabelText('Venue name');
    await fillMinimum(user);

    await user.click(submitButton());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.click(submitButton());
    expect(await screen.findByText('Organizer home marker')).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it('sends once even if the form is submitted again while the request is in flight', async () => {
    openAs('ORGANIZER');
    let release: () => void = () => undefined;
    api.handlers['/v1/matches'] = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(json(matchDetail(), 201));
      });
    const user = userEvent.setup();
    renderApp('/organizer/matches/new');
    await screen.findByLabelText('Venue name');
    await fillMinimum(user);

    await user.click(submitButton());
    await waitFor(() => expect(submitButton()).toBeDisabled());
    expect(submitButton()).toHaveAttribute('aria-busy', 'true');
    fireEvent.submit(submitButton().closest('form') as HTMLFormElement);
    fireEvent.submit(submitButton().closest('form') as HTMLFormElement);

    release();
    expect(await screen.findByText('Organizer home marker')).toBeInTheDocument();
    expect(
      api.calls.filter(
        (call) => call.init?.method === 'POST' && call.url.pathname === '/api/v1/matches',
      ),
    ).toHaveLength(1);
  });
});

describe('accidental submits and exits', () => {
  it('does not announce the match when Enter is pressed in a text field, not even in the region search', async () => {
    openAs('ORGANIZER');
    api.handlers['/v1/matches'] = () => json(matchDetail(), 201);
    const user = userEvent.setup();
    renderApp('/organizer/matches/new');
    await screen.findByLabelText('Venue name');
    await fillMinimum(user);

    await user.type(screen.getByLabelText('Venue name'), '{Enter}');
    await user.click(regionButton());
    const dialog = await screen.findByRole('dialog', { name: 'Choose region' });
    await user.type(
      within(dialog).getByRole('searchbox', { name: 'Search regions' }),
      'mapo{Enter}',
    );
    expect(screen.getByRole('dialog', { name: 'Choose region' })).toBeInTheDocument();
    expect(api.find('POST', '/v1/matches')).toBeUndefined();

    // A textarea still takes line breaks, and the button still sends.
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await user.type(screen.getByLabelText('About this match'), 'one{Enter}two');
    expect(screen.getByLabelText('About this match')).toHaveValue('one\ntwo');
    await user.click(submitButton());
    await waitFor(() => expect(api.find('POST', '/v1/matches')).toBeDefined());
    expect(bodyOf('POST', '/v1/matches')).toMatchObject({
      translations: { en: { description: 'one\ntwo' } },
    });
  });

  it('warns before the page is closed or reloaded only when there is typed work to lose', async () => {
    openAs('ORGANIZER');
    const user = userEvent.setup();
    renderApp('/organizer/matches/new');
    await user.type(await screen.findByLabelText('Venue name'), '마');
    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(unload()).toBe(true);

    await user.clear(screen.getByLabelText('Venue name'));
    expect(unload()).toBe(false);
  });
});

describe('leaving the form', () => {
  it('goes straight back when nothing was typed', async () => {
    openAs('ORGANIZER');
    const user = userEvent.setup();
    renderApp('/organizer/matches/new');
    await screen.findByLabelText('Venue name');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Organizer home marker')).toBeInTheDocument();
  });

  it('asks before throwing typed work away, and can keep editing', async () => {
    openAs('ORGANIZER');
    const user = userEvent.setup();
    renderApp('/organizer/matches/new');
    await user.type(await screen.findByLabelText('Venue name'), '마포');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const dialog = await screen.findByRole('dialog', { name: 'Discard your changes?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByText('Organizer home marker')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Venue name')).toHaveValue('마포');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Discard your changes?' })).getByRole(
        'button',
        { name: 'Discard and leave' },
      ),
    );
    expect(await screen.findByText('Organizer home marker')).toBeInTheDocument();
    expect(api.find('POST', '/v1/matches')).toBeUndefined();
  });
});

describe('editing a match', () => {
  // 22:00-00:00 on Saturday 4 May 2030 in Seoul, stored in UTC.
  const saved = {
    sourceLanguage: 'uz',
    regionCode: 'gyeonggi-ansan',
    startsAt: '2030-05-04T13:00:00.000Z',
    endsAt: '2030-05-04T15:00:00.000Z',
    venueName: '안산 풋살파크',
    venueAddress: null,
    playersPerSide: 6,
    maxPlayers: 14,
    translations: {
      uz: {
        title: 'Ansan juma futzal',
        description: 'Barcha darajalar',
        rules: null,
        locationInstructions: null,
        equipmentRequirements: null,
        cancellationPolicy: null,
      },
      ko: {
        title: '안산 금요 풋살',
        description: null,
        rules: '슬라이딩 금지',
        locationInstructions: null,
        equipmentRequirements: null,
        cancellationPolicy: null,
      },
    },
  };

  it('loads the saved texts, pre-fills everything in Korean time and saves with PUT', async () => {
    openAs('ORGANIZER', [GYEONGGI]);
    api.handlers['/v1/matches/m1/translations'] = () => json(saved);
    api.handlers['/v1/matches/m1'] = () => json(matchDetail({ id: 'm1' }));
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    const user = userEvent.setup();
    renderApp('/organizer/matches/m1/edit');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Edit match' }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText('Venue name')).toHaveValue('안산 풋살파크');
    expect(regionButton()).toHaveAccessibleName('Region Gyeonggi Ansan');
    expect(screen.getByLabelText('Date')).toHaveValue('2030-05-04');
    expect(screen.getByLabelText('Start time')).toHaveValue('22:00');
    expect(screen.getByLabelText('End time')).toHaveValue('00:00');
    expect(screen.getByText('Sat, May 4 · 22:00–00:00 · Korea time')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Players per side' })).toHaveValue(6);
    expect(screen.getByRole('spinbutton', { name: 'Max players' })).toHaveValue(14);
    expect(screen.getByRole('radio', { name: 'O‘zbekcha' })).toBeChecked();
    expect(screen.getByRole('tab', { name: /O‘zbekcha/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Title')).toHaveValue('Ansan juma futzal');
    expect(screen.getByLabelText('About this match')).toHaveValue('Barcha darajalar');
    expect(screen.getByRole('tab', { name: 'O‘zbekcha Filled' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'English Empty' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /한국어/ }));
    expect(screen.getByLabelText('Title')).toHaveValue('안산 금요 풋살');
    expect(screen.getByLabelText('Rules')).toHaveValue('슬라이딩 금지');
    expect(submitButton('Save changes')).toBeEnabled();

    await user.clear(screen.getByLabelText('Venue name'));
    await user.type(screen.getByLabelText('Venue name'), '안산 풋살 아레나');
    await user.click(submitButton('Save changes'));

    await waitFor(() => expect(api.find('PUT', '/v1/matches/m1')).toBeDefined());
    expect(api.find('POST', '/v1/matches')).toBeUndefined();
    expect(bodyOf('PUT', '/v1/matches/m1')).toEqual({
      sourceLanguage: 'uz',
      regionCode: 'gyeonggi-ansan',
      startsAt: '2030-05-04T22:00:00+09:00',
      endsAt: '2030-05-05T00:00:00+09:00',
      venueName: '안산 풋살 아레나',
      venueAddress: null,
      playersPerSide: 6,
      maxPlayers: 14,
      translations: {
        uz: {
          title: 'Ansan juma futzal',
          description: 'Barcha darajalar',
          rules: null,
          locationInstructions: null,
          equipmentRequirements: null,
          cancellationPolicy: null,
        },
        ko: {
          title: '안산 금요 풋살',
          description: null,
          rules: '슬라이딩 금지',
          locationInstructions: null,
          equipmentRequirements: null,
          cancellationPolicy: null,
        },
      },
    });
    expect(await screen.findByText('Organizer home marker')).toBeInTheDocument();
    expect(screen.getByText('Changes saved')).toBeInTheDocument();
    for (const key of ['feed', 'match', 'organized-matches', 'match-translations']) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
    }
  });

  it('shows saved Korean time even when the device is in another time zone', async () => {
    const original = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      openAs('ORGANIZER', [GYEONGGI]);
      api.handlers['/v1/matches/m1/translations'] = () => json(saved);
      renderApp('/organizer/matches/m1/edit');
      expect(await screen.findByLabelText('Date')).toHaveValue('2030-05-04');
      expect(screen.getByLabelText('Start time')).toHaveValue('22:00');
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('does not allow changing a match that has already started', async () => {
    openAs('ORGANIZER', [GYEONGGI]);
    api.handlers['/v1/matches/m1/translations'] = () =>
      json({ ...saved, startsAt: '2020-01-01T10:00:00.000Z', endsAt: '2020-01-01T12:00:00.000Z' });
    renderApp('/organizer/matches/m1/edit');

    expect(
      await screen.findByText('A match that has already started can’t be edited.'),
    ).toBeInTheDocument();
    expect(submitButton('Save changes')).toBeDisabled();
    expect(screen.getByLabelText('Venue name')).toBeDisabled();
    expect(regionButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  it('keeps the form and everything typed when refreshing the saved match fails in the background', async () => {
    openAs('ORGANIZER', [GYEONGGI]);
    let failing = false;
    api.handlers['/v1/matches/m1/translations'] = () =>
      failing ? apiError('INTERNAL_ERROR', 500) : json(saved);
    const user = userEvent.setup();
    renderApp('/organizer/matches/m1/edit');
    const venue = await screen.findByLabelText('Venue name');
    await user.type(venue, ' 2');

    failing = true;
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await waitFor(() =>
      expect(api.calls.filter((call) => call.url.pathname.endsWith('/translations'))).toHaveLength(
        2,
      ),
    );
    await waitFor(() => expect(screen.getByLabelText('Venue name')).toHaveValue('안산 풋살파크 2'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(submitButton('Save changes')).toBeEnabled();
  });

  it('asks the organizer to choose again when the saved region is no longer available', async () => {
    openAs('ORGANIZER', [GYEONGGI]);
    api.handlers['/v1/matches/m1/translations'] = () => json({ ...saved, regionCode: 'jeju' });
    renderApp('/organizer/matches/m1/edit');

    await screen.findByLabelText('Venue name');
    expect(regionButton()).toHaveAccessibleName('Region Choose a region');
  });

  it('says a match is missing without offering a pointless retry, but offers one for a failure', async () => {
    openAs('ORGANIZER', [GYEONGGI]);
    api.handlers['/v1/matches/m1/translations'] = () => apiError('MATCH_NOT_FOUND', 404);
    renderApp('/organizer/matches/m1/edit');
    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t find this match.');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('offers a retry when loading fails for a reason that may pass', async () => {
    openAs('ORGANIZER', [GYEONGGI]);
    let attempts = 0;
    api.handlers['/v1/matches/m1/translations'] = () =>
      ++attempts === 1 ? apiError('INTERNAL_ERROR', 500) : json(saved);
    const user = userEvent.setup();
    renderApp('/organizer/matches/m1/edit');

    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Venue name')).toHaveValue('안산 풋살파크');
  });

  it('shows a loading skeleton, not an empty form, until the match arrives', async () => {
    openAs('ORGANIZER', [GYEONGGI]);
    let release: () => void = () => undefined;
    api.handlers['/v1/matches/m1/translations'] = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(json(saved));
      });
    const { container } = renderApp('/organizer/matches/m1/edit');

    await screen.findByRole('heading', { level: 1, name: 'Edit match' });
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByLabelText('Venue name')).not.toBeInTheDocument();
    release();
    expect(await screen.findByLabelText('Venue name')).toBeInTheDocument();
  });
});

describe('access', () => {
  it('keeps players out; the form does not even ask for regions', async () => {
    openAs('PLAYER');
    renderApp('/organizer/matches/new');

    expect(
      await screen.findByRole('heading', { name: 'You don’t have permission to do this.' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Venue name')).not.toBeInTheDocument();
    expect(api.find('GET', '/v1/me/organizer-regions')).toBeUndefined();
  });

  it('asks a signed-out visitor to log in', async () => {
    api.handlers['/v1/auth/config'] = () => json({ telegramBotUsername: null, devLogin: true });
    renderApp('/organizer/matches/new');
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Venue name')).not.toBeInTheDocument();
  });
});
