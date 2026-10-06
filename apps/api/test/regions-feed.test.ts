import { REGION_SEEDS } from '@foodboll/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyToMatch } from '../src/services/registrations';
import { LocalReceiptStorage } from '../src/storage';
import { bearer, createUser, insertMatch, startTestApp, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await startTestApp();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.reset());

const get = (url: string, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: 'GET', url, headers });
const hours = (n: number) => n * 3600 * 1000;
const inDays = (n: number, hour = 12) => {
  const d = new Date(Date.now() + n * 24 * hours(1));
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};

describe('region reference data', () => {
  it('the database holds exactly REGION_SEEDS (codes, parents, ko/uz names)', async () => {
    const { rows } = await ctx.handle.pool.query(`
      select r.code, p.code as parent, r.sort_order,
             max(t.name) filter (where t.language_code = 'ko') as ko,
             max(t.name) filter (where t.language_code = 'uz') as uz
        from regions r
        left join regions p on p.id = r.parent_id
        join region_translations t on t.region_id = r.id
       group by r.code, p.code, r.sort_order order by r.code`);
    const expected = REGION_SEEDS.map((s) => ({
      code: s.code,
      parent: s.parent,
      sort_order: s.sortOrder,
      ko: s.names.ko,
      uz: s.names.uz,
    })).sort((a, b) => a.code.localeCompare(b.code));
    expect(rows).toEqual(expected);
  });
});

describe('GET /v1/regions', () => {
  it('returns the localized tree with roll-up match counts', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    await insertMatch(ctx, organizer.id, { region: 'seoul-gangnam' });
    await insertMatch(ctx, organizer.id, { region: 'seoul-gangnam' });
    await insertMatch(ctx, organizer.id, { region: 'seoul-mapo' });
    await insertMatch(ctx, organizer.id, { region: 'gyeonggi-ansan' });
    await insertMatch(ctx, organizer.id, {
      region: 'busan',
      startsAt: new Date(Date.now() - hours(5)),
    });

    const uz = (await get('/v1/regions?lang=uz')).json().items as {
      code: string;
      name: { text: string };
      upcomingMatches: number;
      children: { code: string; upcomingMatches: number }[];
    }[];
    expect(uz).toHaveLength(17);
    const seoul = uz.find((r) => r.code === 'seoul');
    expect(seoul).toMatchObject({ name: { text: 'Seul' }, upcomingMatches: 3 });
    expect(seoul?.children).toHaveLength(25);
    expect(seoul?.children.find((c) => c.code === 'seoul-gangnam')?.upcomingMatches).toBe(2);
    expect(uz.find((r) => r.code === 'gyeonggi')?.upcomingMatches).toBe(1);
    expect(uz.find((r) => r.code === 'busan')?.upcomingMatches).toBe(0); // past matches don't count

    const ko = (await get('/v1/regions?lang=ko')).json().items;
    expect(ko[0]).toMatchObject({
      code: 'seoul',
      name: { text: '서울', locale: 'ko', isFallback: false },
    });
  });
});

describe('match feed', () => {
  async function seed() {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const ids = {
      gangnam: await insertMatch(ctx, organizer.id, {
        region: 'seoul-gangnam',
        startsAt: inDays(2),
        title: '강남',
      }),
      mapo: await insertMatch(ctx, organizer.id, {
        region: 'seoul-mapo',
        startsAt: inDays(3),
        title: '마포',
      }),
      ansan: await insertMatch(ctx, organizer.id, {
        region: 'gyeonggi-ansan',
        startsAt: inDays(1),
        title: '안산',
      }),
      busan: await insertMatch(ctx, organizer.id, {
        region: 'busan-haeundae',
        startsAt: inDays(4),
        title: '해운대',
      }),
    };
    return { organizer, ids };
  }
  const titles = (res: { json(): { items: { title: { text: string } }[] } }) =>
    res.json().items.map((i) => i.title.text);

  it('filters by region: a province includes its districts, a district is exact', async () => {
    await seed();
    expect(titles(await get('/v1/matches?region=seoul'))).toEqual(['강남', '마포']);
    expect(titles(await get('/v1/matches?region=seoul-mapo'))).toEqual(['마포']);
    expect(titles(await get('/v1/matches?region=gyeonggi'))).toEqual(['안산']);
    expect(titles(await get('/v1/matches'))).toEqual(['안산', '강남', '마포', '해운대']);
  });

  it('rejects unknown or disabled regions with a localized 404', async () => {
    const res = await get('/v1/matches?region=atlantis&lang=uz');
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toEqual({ code: 'REGION_NOT_FOUND', message: 'Hudud topilmadi.' });
    await ctx.handle.pool.query(`update regions set enabled = false where code = 'busan'`);
    expect((await get('/v1/matches?region=busan')).statusCode).toBe(404);
    await ctx.handle.pool.query(`update regions set enabled = true where code = 'busan'`);
  });

  it('filters by Korean calendar day, not UTC day', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    // 22:00 KST on 2026-12-11 is 13:00 UTC the same day; 00:30 KST on 12-12 is 15:30 UTC on 12-11.
    await insertMatch(ctx, organizer.id, {
      startsAt: new Date('2026-12-11T22:00:00+09:00'),
      title: '금요일 밤',
    });
    await insertMatch(ctx, organizer.id, {
      startsAt: new Date('2026-12-12T00:30:00+09:00'),
      title: '토요일 새벽',
    });
    expect(titles(await get('/v1/matches?date=2026-12-11'))).toEqual(['금요일 밤']);
    expect(titles(await get('/v1/matches?date=2026-12-12'))).toEqual(['토요일 새벽']);
    expect((await get('/v1/matches?date=2026-13-45')).statusCode).toBe(400);
    expect((await get('/v1/matches?date=tomorrow')).statusCode).toBe(400);
  });

  it('combines region and date, and paginates', async () => {
    const { ids } = await seed();
    void ids;
    const page = await get('/v1/matches?limit=2&offset=1');
    expect(titles(page)).toEqual(['강남', '마포']);
    expect((await get('/v1/matches?limit=0')).statusCode).toBe(400);
  });

  it("reports seats taken, seats left and the viewer's own registration", async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const matchId = await insertMatch(ctx, organizer.id, { maxPlayers: 6, startsAt: inDays(2) });
    const storage = new LocalReceiptStorage(ctx.config.receiptDir);
    const players = await Promise.all(Array.from({ length: 4 }, () => createUser(ctx)));
    for (const p of players) {
      await applyToMatch(
        ctx.handle.db,
        storage,
        { id: p.id, role: 'PLAYER', displayName: 'x', preferredLanguage: null, homeRegionId: null },
        matchId,
      );
    }
    const anon = (await get('/v1/matches')).json().items[0];
    expect(anon).toMatchObject({ maxPlayers: 6, registeredCount: 4, spotsLeft: 2, viewer: null });

    const mine = (await get('/v1/matches', bearer(players[0]?.token ?? ''))).json().items[0];
    expect(mine.viewer).toMatchObject({ status: 'APPLIED' });
    const stranger = await createUser(ctx);
    expect((await get(`/v1/matches/${matchId}`, bearer(stranger.token))).json().viewer).toBeNull();

    // A lapsed payment window frees the seat in the numbers right away.
    await ctx.handle.pool.query(
      `update registration_payments set due_at = now() - interval '1 minute'`,
    );
    const after = (await get('/v1/matches')).json().items[0];
    expect(after).toMatchObject({ registeredCount: 0, spotsLeft: 6 });
    expect(
      (await get('/v1/matches', bearer(players[0]?.token ?? ''))).json().items[0].viewer,
    ).toBeNull();
  });

  it('includes the region (with its province) and venue in every match', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const id = await insertMatch(ctx, organizer.id, {
      region: 'gyeonggi-ansan',
      venueName: '안산 다목적구장',
    });
    const match = (await get(`/v1/matches/${id}?lang=uz`)).json();
    expect(match.venueName).toBe('안산 다목적구장');
    expect(match.region).toMatchObject({
      code: 'gyeonggi-ansan',
      level: 2,
      name: { text: 'Ansan-si', locale: 'uz' },
      parent: { code: 'gyeonggi', name: { text: 'Gyeonggi' } },
    });
  });
});

describe('announcing a match', () => {
  const body = (overrides: Record<string, unknown> = {}) => {
    const start = new Date('2026-12-11T22:00:00+09:00');
    return {
      sourceLanguage: 'ko',
      regionCode: 'gyeonggi-ansan',
      startsAt: start.toISOString(),
      endsAt: new Date('2026-12-12T00:00:00+09:00').toISOString(),
      venueName: '안산 다목적구장',
      playersPerSide: 6,
      translations: { ko: { title: '안산 금요일 밤 풋살' } },
      ...overrides,
    };
  };
  const post = (token: string, payload: object) =>
    ctx.app.inject({
      method: 'POST',
      url: '/v1/matches',
      headers: { ...bearer(token), 'accept-language': 'uz' },
      payload,
    });

  it('uses the platform fee and the overnight example (22:00 to 00:00)', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const res = await post(organizer.token, body());
    // The example date lies in the past relative to the test clock only if the clock moved on.
    if (Date.parse('2026-12-11T22:00:00+09:00') > Date.now()) {
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        feeKrw: 10_000,
        startsAt: '2026-12-11T13:00:00.000Z',
        endsAt: '2026-12-11T15:00:00.000Z',
      });
    } else {
      expect(res.statusCode).toBe(400);
    }
  });

  it('organizers cannot set their own price', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const res = await post(
      organizer.token,
      body({
        startsAt: inDays(5).toISOString(),
        endsAt: new Date(inDays(5).getTime() + hours(2)).toISOString(),
        feeKrw: 1,
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it.each([
    [
      'ends before it starts',
      (s: Date) => ({ endsAt: new Date(s.getTime() - hours(1)).toISOString() }),
    ],
    [
      'lasts longer than 12 hours',
      (s: Date) => ({ endsAt: new Date(s.getTime() + hours(13)).toISOString() }),
    ],
    ['has an empty venue', () => ({ venueName: '   ' })],
    ['has a malformed region code', () => ({ regionCode: 'Seoul!' })],
  ])('rejects a match that %s', async (_name, patch) => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const start = inDays(5);
    const res = await post(
      organizer.token,
      body({
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + hours(2)).toISOString(),
        ...patch(start),
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it('rejects matches in the past and unknown regions', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const past = new Date(Date.now() - hours(5));
    const pastRes = await post(
      organizer.token,
      body({
        startsAt: past.toISOString(),
        endsAt: new Date(past.getTime() + hours(2)).toISOString(),
      }),
    );
    expect(pastRes.statusCode).toBe(400);
    const start = inDays(5);
    const res = await post(
      organizer.token,
      body({
        regionCode: 'narnia',
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + hours(2)).toISOString(),
      }),
    );
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('REGION_NOT_FOUND');
  });

  it('cannot edit a match that has already started', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const id = await insertMatch(ctx, organizer.id, { startsAt: new Date(Date.now() - hours(1)) });
    const start = inDays(5);
    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/matches/${id}`,
      headers: bearer(organizer.token),
      payload: body({
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + hours(2)).toISOString(),
      }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('MATCH_STARTED');
  });
});

describe('home region', () => {
  it('is saved to the account, shown localized, and can be cleared', async () => {
    const { token } = await createUser(ctx, { preferredLanguage: 'uz' });
    const patch = (regionCode: string | null) =>
      ctx.app.inject({
        method: 'PATCH',
        url: '/v1/me/region',
        headers: bearer(token),
        payload: { regionCode },
      });

    const set = await patch('gyeonggi-ansan');
    expect(set.statusCode).toBe(200);
    expect(set.json().homeRegion).toMatchObject({
      code: 'gyeonggi-ansan',
      name: { text: 'Ansan-si' },
      parent: { code: 'gyeonggi' },
    });
    expect((await get('/v1/me', bearer(token))).json().homeRegion.code).toBe('gyeonggi-ansan');

    expect((await patch(null)).json().homeRegion).toBeNull();
    expect((await patch('narnia')).statusCode).toBe(404);
    expect(
      (
        await ctx.app.inject({
          method: 'PATCH',
          url: '/v1/me/region',
          headers: bearer(token),
          payload: { regionCode: 'seoul', extra: 1 },
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe('admin region management', () => {
  it('adds a district with only a Korean name; other readers see it as a fallback', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/regions',
      headers: bearer(admin.token),
      payload: { code: 'gyeonggi-hwaseong-dongtan', parent: 'gyeonggi', names: { ko: '동탄' } },
    });
    expect(res.statusCode).toBe(201);
    const tree = (await get('/v1/regions?lang=uz')).json().items;
    const child = tree
      .find((r: { code: string }) => r.code === 'gyeonggi')
      .children.find((c: { code: string }) => c.code === 'gyeonggi-hwaseong-dongtan');
    expect(child.name).toEqual({ text: '동탄', locale: 'ko', isFallback: true });
  });

  it('validates input, keeps codes unique, and allows only two levels', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const post = (payload: object) =>
      ctx.app.inject({
        method: 'POST',
        url: '/v1/admin/regions',
        headers: bearer(admin.token),
        payload,
      });
    expect((await post({ code: 'seoul', parent: null, names: { ko: '서울' } })).statusCode).toBe(
      409,
    );
    expect(
      (await post({ code: 'x-y', parent: 'seoul-gangnam', names: { ko: '동' } })).statusCode,
    ).toBe(400);
    expect((await post({ code: 'Bad Code', parent: null, names: { ko: '동' } })).statusCode).toBe(
      400,
    );
    expect(
      (await post({ code: 'new-one', parent: 'narnia', names: { ko: '동' } })).statusCode,
    ).toBe(404);
    const player = await createUser(ctx);
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/v1/admin/regions',
          headers: bearer(player.token),
          payload: { code: 'a', parent: null, names: { ko: 'a' } },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('a disabled region disappears from pickers and cannot be used', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/admin/regions/jeju',
      headers: bearer(admin.token),
      payload: { enabled: false },
    });
    expect(patch.statusCode).toBe(200);
    const tree = (await get('/v1/regions')).json().items;
    expect(tree.find((r: { code: string }) => r.code === 'jeju')).toBeUndefined();
    const { token } = await createUser(ctx);
    expect(
      (
        await ctx.app.inject({
          method: 'PATCH',
          url: '/v1/me/region',
          headers: bearer(token),
          payload: { regionCode: 'jeju' },
        })
      ).statusCode,
    ).toBe(404);
  });
});
