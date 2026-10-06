import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createUser, startTestApp, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await startTestApp();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.reset());

const hours = (n: number) => n * 3600 * 1000;
const matchBody = (regionCode: string, overrides: Record<string, unknown> = {}) => {
  const start = new Date(Date.now() + 5 * 24 * hours(1));
  return {
    sourceLanguage: 'ko',
    regionCode,
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + hours(2)).toISOString(),
    venueName: '구장',
    playersPerSide: 5,
    translations: { ko: { title: '매치' } },
    ...overrides,
  };
};
const send = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  url: string,
  token: string | null,
  payload?: object,
  headers: Record<string, string> = {},
) =>
  ctx.app.inject({
    method,
    url,
    headers: { ...(token ? bearer(token) : {}), ...headers },
    ...(payload && { payload }),
  });

describe('publishing is limited to the regions an organizer was granted', () => {
  it('a district grant covers only that district', async () => {
    const organizer = await createUser(ctx, {
      role: 'ORGANIZER',
      organizerRegions: ['gyeonggi-ansan'],
    });
    expect(
      (await send('POST', '/v1/matches', organizer.token, matchBody('gyeonggi-ansan'))).statusCode,
    ).toBe(201);
    const outside = await send(
      'POST',
      '/v1/matches',
      organizer.token,
      matchBody('gyeonggi-suwon'),
      { 'accept-language': 'uz' },
    );
    expect(outside.statusCode).toBe(403);
    expect(outside.json().error).toEqual({
      code: 'REGION_FORBIDDEN',
      message: 'Bu hududda match e’lon qilishga ruxsatingiz yo‘q.',
    });
    expect(
      (await send('POST', '/v1/matches', organizer.token, matchBody('seoul'))).statusCode,
    ).toBe(403);
  });

  it('a province grant covers the province and all of its districts', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER', organizerRegions: ['gyeonggi'] });
    for (const code of ['gyeonggi', 'gyeonggi-ansan', 'gyeonggi-suwon']) {
      expect((await send('POST', '/v1/matches', organizer.token, matchBody(code))).statusCode).toBe(
        201,
      );
    }
    expect(
      (await send('POST', '/v1/matches', organizer.token, matchBody('incheon'))).statusCode,
    ).toBe(403);
  });

  it('cannot move an existing match into a region they do not cover', async () => {
    const organizer = await createUser(ctx, {
      role: 'ORGANIZER',
      organizerRegions: ['gyeonggi-ansan'],
    });
    const created = (
      await send('POST', '/v1/matches', organizer.token, matchBody('gyeonggi-ansan'))
    ).json();
    const move = await send(
      'PUT',
      `/v1/matches/${created.id}`,
      organizer.token,
      matchBody('seoul-gangnam'),
    );
    expect(move.statusCode).toBe(403);
    expect(
      (await send('PUT', `/v1/matches/${created.id}`, organizer.token, matchBody('gyeonggi-ansan')))
        .statusCode,
    ).toBe(200);
  });

  it('admins are not restricted, and an organizer with no regions cannot publish', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    expect((await send('POST', '/v1/matches', admin.token, matchBody('jeju'))).statusCode).toBe(
      201,
    );
    const none = await createUser(ctx, { role: 'ORGANIZER', organizerRegions: [] });
    expect((await send('POST', '/v1/matches', none.token, matchBody('seoul'))).statusCode).toBe(
      403,
    );
    const player = await createUser(ctx);
    expect((await send('POST', '/v1/matches', player.token, matchBody('seoul'))).statusCode).toBe(
      403,
    );
  });
});

describe('becoming an organizer', () => {
  it('a player applies, an admin approves, and they can then publish there', async () => {
    const player = await createUser(ctx, { displayName: 'Aziz', preferredLanguage: 'uz' });
    const admin = await createUser(ctx, { role: 'ADMIN' });
    expect(
      (await send('POST', '/v1/matches', player.token, matchBody('gyeonggi-ansan'))).statusCode,
    ).toBe(403);

    const applied = await send('POST', '/v1/organizer-applications', player.token, {
      regionCode: 'gyeonggi-ansan',
      message: '  안산에서 매주 금요일 풋살을 합니다.  ',
    });
    expect(applied.statusCode).toBe(201);
    expect(applied.json()).toMatchObject({
      status: 'PENDING',
      message: '안산에서 매주 금요일 풋살을 합니다.',
      region: { code: 'gyeonggi-ansan' },
      applicant: { id: player.id, displayName: 'Aziz' },
    });

    const queue = (await send('GET', '/v1/admin/organizer-applications', admin.token)).json();
    expect(queue.items).toHaveLength(1);
    const approved = await send(
      'POST',
      `/v1/admin/organizer-applications/${queue.items[0].id}/approve`,
      admin.token,
      {},
    );
    expect(approved.json()).toMatchObject({ status: 'APPROVED' });

    expect((await send('GET', '/v1/me', player.token)).json().role).toBe('ORGANIZER');
    expect(
      (await send('GET', '/v1/me/organizer-regions', player.token))
        .json()
        .items.map((r: { code: string }) => r.code),
    ).toEqual(['gyeonggi-ansan']);
    expect(
      (await send('POST', '/v1/matches', player.token, matchBody('gyeonggi-ansan'))).statusCode,
    ).toBe(201);
    expect(
      (await send('POST', '/v1/matches', player.token, matchBody('gyeonggi-suwon'))).statusCode,
    ).toBe(403);

    // They are told, in their own language.
    const inbox = (await send('GET', '/v1/me/notifications', player.token)).json();
    expect(inbox.items[0]).toMatchObject({
      type: 'ORGANIZER_APPROVED',
      title: 'Tashkilotchi sifatida tasdiqlandi',
    });
  });

  it('a rejection changes nothing but the status, and the player is told', async () => {
    const player = await createUser(ctx, { preferredLanguage: 'ko' });
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const app = (
      await send('POST', '/v1/organizer-applications', player.token, { regionCode: 'busan' })
    ).json();
    const rejected = await send(
      'POST',
      `/v1/admin/organizer-applications/${app.id}/reject`,
      admin.token,
      {},
    );
    expect(rejected.json().status).toBe('REJECTED');
    expect((await send('GET', '/v1/me', player.token)).json().role).toBe('PLAYER');
    expect((await send('GET', '/v1/me/notifications', player.token)).json().items[0].body).toBe(
      '이번에는 주최자 신청이 승인되지 않았습니다.',
    );
    expect(
      (await send('GET', '/v1/me/organizer-applications', player.token)).json().items[0].status,
    ).toBe('REJECTED');
    // They may try again later.
    expect(
      (await send('POST', '/v1/organizer-applications', player.token, { regionCode: 'busan' }))
        .statusCode,
    ).toBe(201);
  });

  it('refuses duplicate open applications, too many at once, and regions they already cover', async () => {
    const player = await createUser(ctx);
    expect(
      (await send('POST', '/v1/organizer-applications', player.token, { regionCode: 'busan' }))
        .statusCode,
    ).toBe(201);
    expect(
      (await send('POST', '/v1/organizer-applications', player.token, { regionCode: 'busan' }))
        .statusCode,
    ).toBe(409);
    await send('POST', '/v1/organizer-applications', player.token, { regionCode: 'daegu' });
    await send('POST', '/v1/organizer-applications', player.token, { regionCode: 'incheon' });
    expect(
      (await send('POST', '/v1/organizer-applications', player.token, { regionCode: 'jeju' }))
        .statusCode,
    ).toBe(409);

    const organizer = await createUser(ctx, { role: 'ORGANIZER', organizerRegions: ['gyeonggi'] });
    expect(
      (
        await send('POST', '/v1/organizer-applications', organizer.token, {
          regionCode: 'gyeonggi-ansan',
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await send('POST', '/v1/organizer-applications', organizer.token, { regionCode: 'seoul' }))
        .statusCode,
    ).toBe(201);
  });

  it('validates input and decisions', async () => {
    const player = await createUser(ctx);
    const admin = await createUser(ctx, { role: 'ADMIN' });
    expect(
      (await send('POST', '/v1/organizer-applications', player.token, { regionCode: 'narnia' }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await send('POST', '/v1/organizer-applications', player.token, {
          regionCode: 'busan',
          message: 'x'.repeat(501),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await send('POST', '/v1/organizer-applications', player.token, {
          regionCode: 'busan',
          role: 'ADMIN',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await send('POST', '/v1/organizer-applications', null, { regionCode: 'busan' })).statusCode,
    ).toBe(401);

    const app = (
      await send('POST', '/v1/organizer-applications', player.token, { regionCode: 'busan' })
    ).json();
    expect(
      (await send('POST', `/v1/admin/organizer-applications/${app.id}/approve`, player.token, {}))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await send(
          'POST',
          '/v1/admin/organizer-applications/00000000-0000-4000-8000-000000000000/approve',
          admin.token,
          {},
        )
      ).statusCode,
    ).toBe(404);
    await send('POST', `/v1/admin/organizer-applications/${app.id}/approve`, admin.token, {});
    expect(
      (await send('POST', `/v1/admin/organizer-applications/${app.id}/reject`, admin.token, {}))
        .statusCode,
    ).toBe(409);
    expect(
      (await send('GET', '/v1/admin/organizer-applications?status=NOPE', admin.token)).statusCode,
    ).toBe(400);
  });

  it('concurrent decisions on one application take effect once', async () => {
    const player = await createUser(ctx);
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const app = (
      await send('POST', '/v1/organizer-applications', player.token, { regionCode: 'busan' })
    ).json();
    const results = await Promise.all([
      send('POST', `/v1/admin/organizer-applications/${app.id}/approve`, admin.token, {}),
      send('POST', `/v1/admin/organizer-applications/${app.id}/approve`, admin.token, {}),
      send('POST', `/v1/admin/organizer-applications/${app.id}/reject`, admin.token, {}),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
    expect(
      (
        await ctx.handle.pool.query(
          'select count(*)::int as n from notifications where user_id = $1',
          [player.id],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('never demotes an admin who applies', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    expect(
      (await send('POST', '/v1/organizer-applications', admin.token, { regionCode: 'busan' }))
        .statusCode,
    ).toBe(409);
  });
});

describe('admin management of organizer regions', () => {
  it('replaces the granted regions and adjusts the role', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const user = await createUser(ctx);
    const put = (regionCodes: string[]) =>
      send('PUT', `/v1/admin/users/${user.id}/organizer-regions`, admin.token, { regionCodes });

    expect(
      (await put(['seoul-gangnam', 'gyeonggi', 'seoul-gangnam'])).json().organizerRegions,
    ).toEqual(['gyeonggi', 'seoul-gangnam']);
    expect((await send('GET', '/v1/me', user.token)).json().role).toBe('ORGANIZER');
    const list = (await send('GET', '/v1/admin/users', admin.token))
      .json()
      .items.find((u: { id: string }) => u.id === user.id);
    expect(list.organizerRegions).toEqual(['gyeonggi', 'seoul-gangnam']);

    expect((await put(['jeju'])).json().organizerRegions).toEqual(['jeju']);
    expect((await put([])).json().organizerRegions).toEqual([]);
    expect((await send('GET', '/v1/me', user.token)).json().role).toBe('PLAYER');
  });

  it('is admin-only, validates regions, and leaves admins alone', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const other = await createUser(ctx, { role: 'ADMIN' });
    const user = await createUser(ctx);
    expect(
      (
        await send('PUT', `/v1/admin/users/${user.id}/organizer-regions`, user.token, {
          regionCodes: ['seoul'],
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await send('PUT', `/v1/admin/users/${user.id}/organizer-regions`, admin.token, {
          regionCodes: ['narnia'],
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await send('PUT', `/v1/admin/users/${other.id}/organizer-regions`, admin.token, {
          regionCodes: ['seoul'],
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await send(
          'PUT',
          '/v1/admin/users/00000000-0000-4000-8000-000000000000/organizer-regions',
          admin.token,
          { regionCodes: [] },
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await send('PUT', `/v1/admin/users/${user.id}/organizer-regions`, admin.token, {
          regionCodes: 'seoul',
        })
      ).statusCode,
    ).toBe(400);
    // A rejected request must not leave the user half-changed.
    expect((await send('GET', '/v1/me', user.token)).json().role).toBe('PLAYER');
  });
});
