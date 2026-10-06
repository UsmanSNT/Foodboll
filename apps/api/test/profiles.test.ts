import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createUser, insertMatch, startTestApp, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await startTestApp();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.reset());

const DAY = 24 * 3600 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const get = (url: string, token: string | null, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: 'GET', url, headers: { ...(token ? bearer(token) : {}), ...headers } });
const put = (url: string, token: string, payload: object) =>
  ctx.app.inject({ method: 'PUT', url, headers: bearer(token), payload });

/** Registers `userId` as a confirmed player of `matchId` and returns the registration id. */
async function confirmed(matchId: string, userId: string, status = 'CONFIRMED'): Promise<string> {
  const { rows } = await ctx.handle.pool.query(
    `insert into match_registrations (match_id, user_id, status) values ($1, $2, $3) returning id`,
    [matchId, userId, status],
  );
  return rows[0].id as string;
}
async function played(
  userId: string,
  organizerId: string,
  when: Date,
  region = 'seoul-gangnam',
  attended: boolean | null = true,
) {
  const matchId = await insertMatch(ctx, organizerId, { startsAt: when, region });
  const registrationId = await confirmed(matchId, userId);
  if (attended !== null) {
    await ctx.handle.pool.query(`update match_registrations set attended = $2 where id = $1`, [
      registrationId,
      attended,
    ]);
  }
  return { matchId, registrationId };
}

describe('attendance sheet', () => {
  it('lists confirmed players for the organizer and lets them mark who came', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const a = await createUser(ctx, { displayName: 'Aziz' });
    const b = await createUser(ctx, { displayName: 'Bobur' });
    const unpaid = await createUser(ctx, { displayName: 'Unpaid' });
    const matchId = await insertMatch(ctx, organizer.id, { startsAt: daysAgo(1) });
    const ra = await confirmed(matchId, a.id);
    const rb = await confirmed(matchId, b.id);
    await confirmed(matchId, unpaid.id, 'APPLIED');

    const roster = (await get(`/v1/matches/${matchId}/roster`, organizer.token)).json().items;
    expect(roster.map((r: { player: { displayName: string } }) => r.player.displayName)).toEqual([
      'Aziz',
      'Bobur',
    ]);
    expect(roster.every((r: { attended: unknown }) => r.attended === null)).toBe(true);

    const res = await put(`/v1/matches/${matchId}/attendance`, organizer.token, {
      marks: [
        { registrationId: ra, attended: true },
        { registrationId: rb, attended: false },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((r: { attended: boolean }) => r.attended)).toEqual([true, false]);

    // Corrections inside the window are allowed and idempotent.
    await put(`/v1/matches/${matchId}/attendance`, organizer.token, {
      marks: [{ registrationId: rb, attended: true }],
    });
    await put(`/v1/matches/${matchId}/attendance`, organizer.token, {
      marks: [{ registrationId: rb, attended: true }],
    });
    expect(
      (await get(`/v1/matches/${matchId}/roster`, organizer.token)).json().items[1].attended,
    ).toBe(true);
  });

  it('cannot be marked before kick-off or long after the match', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const p = await createUser(ctx);
    const future = await insertMatch(ctx, organizer.id, { startsAt: new Date(Date.now() + DAY) });
    const regFuture = await confirmed(future, p.id);
    const early = await put(`/v1/matches/${future}/attendance`, organizer.token, {
      marks: [{ registrationId: regFuture, attended: true }],
    });
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe('MATCH_NOT_STARTED');

    const old = await insertMatch(ctx, organizer.id, { startsAt: daysAgo(30) });
    const regOld = await confirmed(old, p.id);
    expect(
      (
        await put(`/v1/matches/${old}/attendance`, organizer.token, {
          marks: [{ registrationId: regOld, attended: true }],
        })
      ).statusCode,
    ).toBe(409);
  });

  it("is limited to the match organizer and admins, and to this match's confirmed players", async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const rival = await createUser(ctx, { role: 'ORGANIZER' });
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const player = await createUser(ctx);
    const matchId = await insertMatch(ctx, organizer.id, { startsAt: daysAgo(1) });
    const otherMatch = await insertMatch(ctx, organizer.id, { startsAt: daysAgo(1) });
    const reg = await confirmed(matchId, player.id);
    const foreign = await confirmed(otherMatch, player.id);
    const unpaid = await confirmed(matchId, (await createUser(ctx)).id, 'APPLIED');
    const url = `/v1/matches/${matchId}/attendance`;

    expect(
      (await put(url, rival.token, { marks: [{ registrationId: reg, attended: true }] }))
        .statusCode,
    ).toBe(403);
    expect(
      (await put(url, player.token, { marks: [{ registrationId: reg, attended: true }] }))
        .statusCode,
    ).toBe(403);
    expect((await get(`/v1/matches/${matchId}/roster`, rival.token)).statusCode).toBe(403);
    expect(
      (await put(url, organizer.token, { marks: [{ registrationId: foreign, attended: true }] }))
        .statusCode,
    ).toBe(404);
    expect(
      (await put(url, organizer.token, { marks: [{ registrationId: unpaid, attended: true }] }))
        .statusCode,
    ).toBe(409);
    expect((await put(url, organizer.token, { marks: [] })).statusCode).toBe(400);
    expect(
      (await put(url, organizer.token, { marks: [{ registrationId: reg, attended: 'yes' }] }))
        .statusCode,
    ).toBe(400);
    expect(
      (await put(url, admin.token, { marks: [{ registrationId: reg, attended: true }] }))
        .statusCode,
    ).toBe(200);
    // Nothing was half-applied by the rejected requests.
    expect(
      (
        await ctx.handle.pool.query(`select attended from match_registrations where id = $1`, [
          foreign,
        ])
      ).rows[0].attended,
    ).toBeNull();
  });

  it('refuses to mark a cancelled registration at the database level', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const p = await createUser(ctx);
    const matchId = await insertMatch(ctx, organizer.id, { startsAt: daysAgo(1) });
    const reg = await confirmed(matchId, p.id, 'CANCELLED');
    await expect(
      ctx.handle.pool.query(`update match_registrations set attended = true where id = $1`, [reg]),
    ).rejects.toThrow(/attendance_confirmed_only/);
  });
});

describe('player profile', () => {
  it('summarizes attendance, level, activity and achievements', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const player = await createUser(ctx, { displayName: 'Aziz', preferredLanguage: 'uz' });
    await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/me/region',
      headers: bearer(player.token),
      payload: { regionCode: 'gyeonggi-ansan' },
    });
    // 5 attended matches in 3 provinces (2 within 90 days), 1 no-show, 1 unmarked.
    await played(player.id, organizer.id, daysAgo(200), 'seoul-gangnam');
    await played(player.id, organizer.id, daysAgo(150), 'busan-haeundae');
    await played(player.id, organizer.id, daysAgo(120), 'gyeonggi-ansan');
    await played(player.id, organizer.id, daysAgo(20), 'gyeonggi-ansan');
    await played(player.id, organizer.id, daysAgo(5), 'gyeonggi-suwon');
    await played(player.id, organizer.id, daysAgo(40), 'seoul-mapo', false);
    await played(player.id, organizer.id, daysAgo(3), 'seoul-mapo', null);

    const res = await get(`/v1/players/${player.id}?lang=uz`, organizer.token);
    expect(res.statusCode).toBe(200);
    const profile = res.json();
    expect(profile).toMatchObject({
      displayName: 'Aziz',
      role: 'PLAYER',
      homeRegion: { code: 'gyeonggi-ansan', name: { text: 'Ansan-si' } },
      xp: 50,
      level: { level: 3, xp: 50, xpIntoLevel: 0, xpForNextLevel: 50 },
      activity: 'OCCASIONAL',
      stats: {
        matchesPlayed: 5,
        noShows: 1,
        last90Days: 2,
        provincesPlayed: 3,
        matchesOrganized: 0,
      },
    });
    expect(profile.stats.attendanceRate).toBeCloseTo(5 / 6, 5);
    expect(profile.achievements).toEqual(['FIRST_MATCH', 'MATCHES_5', 'EXPLORER']);
    expect(profile.recentMatches).toHaveLength(5);
    expect(profile.recentMatches.map((m: { region: { code: string } }) => m.region.code)).toEqual([
      'gyeonggi-suwon',
      'gyeonggi-ansan',
      'gyeonggi-ansan',
      'busan-haeundae',
      'seoul-gangnam',
    ]);
    expect(profile.stats.firstMatchAt < profile.stats.lastMatchAt).toBe(true);
  });

  it('counts organizing, and a brand-new player starts at level 1', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    await insertMatch(ctx, organizer.id, { startsAt: daysAgo(3) });
    await insertMatch(ctx, organizer.id, { startsAt: daysAgo(2) });
    await insertMatch(ctx, organizer.id, { startsAt: new Date(Date.now() + DAY) }); // not over yet
    const profile = (await get('/v1/me/profile', organizer.token)).json();
    expect(profile.stats.matchesOrganized).toBe(2);
    expect(profile).toMatchObject({ xp: 30, level: { level: 2 }, achievements: ['ORGANIZER'] });

    const fresh = await createUser(ctx);
    expect((await get('/v1/me/profile', fresh.token)).json()).toMatchObject({
      xp: 0,
      level: { level: 1, xpIntoLevel: 0, xpForNextLevel: 20 },
      activity: 'NEW',
      achievements: [],
      recentMatches: [],
      stats: { attendanceRate: null, firstMatchAt: null },
    });
  });

  it('shows other players only public information', async () => {
    const viewer = await createUser(ctx);
    const target = await createUser(ctx, {
      displayName: 'Target',
      preferredLanguage: 'uz',
      deviceLocale: 'uz-UZ',
      telegramId: '4242',
      telegramStarted: true,
    });
    await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/me/depositor-name',
      headers: bearer(target.token),
      payload: { depositorName: 'SECRET NAME' },
    });
    const res = await get(`/v1/players/${target.id}`, viewer.token);
    const keys = Object.keys(res.json()).sort();
    expect(keys).toEqual([
      'achievements',
      'activity',
      'displayName',
      'homeRegion',
      'id',
      'level',
      'memberSince',
      'recentMatches',
      'role',
      'stats',
      'xp',
    ]);
    for (const secret of [
      'SECRET NAME',
      'uz-UZ',
      '4242',
      'telegram',
      'depositor',
      'preferredLanguage',
    ]) {
      expect(res.body).not.toContain(secret);
    }
  });

  it('requires sign-in and reports unknown players', async () => {
    const user = await createUser(ctx);
    expect((await get(`/v1/players/${user.id}`, null)).statusCode).toBe(401);
    expect((await get('/v1/players', null)).statusCode).toBe(401);
    const missing = await get(
      '/v1/players/00000000-0000-4000-8000-000000000000?lang=uz',
      user.token,
    );
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toEqual({
      code: 'PLAYER_NOT_FOUND',
      message: 'Futbolchi topilmadi.',
    });
    expect((await get('/v1/players/not-a-uuid', user.token)).statusCode).toBe(400);
  });
});

describe('finding players', () => {
  it('searches by name prefix, case-insensitively, treating wildcards literally', async () => {
    const me = await createUser(ctx, { displayName: 'Searcher' });
    await createUser(ctx, { displayName: 'Aziz Karimov' });
    await createUser(ctx, { displayName: 'azamat' });
    await createUser(ctx, { displayName: 'Bobur' });
    await createUser(ctx, { displayName: '100% Player' });
    const names = async (q: string) =>
      (await get(`/v1/players?q=${encodeURIComponent(q)}`, me.token))
        .json()
        .items.map((i: { displayName: string }) => i.displayName);
    expect(await names('az')).toEqual(['azamat', 'Aziz Karimov']);
    expect(await names('AZI')).toEqual(['Aziz Karimov']);
    expect(await names('%')).toEqual([]);
    expect(await names('100%')).toEqual(['100% Player']);
    expect(await names('_')).toEqual([]);
    expect(await names('')).toHaveLength(5);
  });

  it('filters by home region (a province includes its districts) and paginates', async () => {
    const me = await createUser(ctx, { displayName: 'Me' });
    const setRegion = async (displayName: string, regionCode: string) => {
      const u = await createUser(ctx, { displayName });
      await ctx.app.inject({
        method: 'PATCH',
        url: '/v1/me/region',
        headers: bearer(u.token),
        payload: { regionCode },
      });
    };
    await setRegion('Ansan 1', 'gyeonggi-ansan');
    await setRegion('Suwon 1', 'gyeonggi-suwon');
    await setRegion('Seoul 1', 'seoul-mapo');
    const names = async (qs: string) =>
      (await get(`/v1/players?${qs}`, me.token))
        .json()
        .items.map((i: { displayName: string }) => i.displayName);
    expect(await names('region=gyeonggi')).toEqual(['Ansan 1', 'Suwon 1']);
    expect(await names('region=gyeonggi-ansan')).toEqual(['Ansan 1']);
    expect(await names('region=gyeonggi&limit=1&offset=1')).toEqual(['Suwon 1']);
    expect((await get('/v1/players?region=narnia', me.token)).statusCode).toBe(404);
    expect((await get(`/v1/players?q=${'x'.repeat(61)}`, me.token)).statusCode).toBe(400);
  });

  it('includes a level on every card', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER', displayName: 'Org' });
    const vet = await createUser(ctx, { displayName: 'Veteran' });
    for (let i = 1; i <= 3; i++) await played(vet.id, organizer.id, daysAgo(i * 10));
    const items = (await get('/v1/players?q=Vet', organizer.token)).json().items;
    expect(items[0]).toMatchObject({ displayName: 'Veteran', level: { level: 2, xp: 30 } });
  });
});

describe('who is going', () => {
  it('lists confirmed players of a match to signed-in users only', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const viewer = await createUser(ctx);
    const going = await createUser(ctx, { displayName: 'Going' });
    const waiting = await createUser(ctx, { displayName: 'Waiting' });
    const matchId = await insertMatch(ctx, organizer.id);
    await confirmed(matchId, going.id);
    await confirmed(matchId, waiting.id, 'APPLIED');
    const res = await get(`/v1/matches/${matchId}/players`, viewer.token);
    expect(res.json().items.map((p: { displayName: string }) => p.displayName)).toEqual(['Going']);
    expect((await get(`/v1/matches/${matchId}/players`, null)).statusCode).toBe(401);
    expect(
      (await get('/v1/matches/00000000-0000-4000-8000-000000000000/players', viewer.token))
        .statusCode,
    ).toBe(404);
  });
});
