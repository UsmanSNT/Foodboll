import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createUser, startTestApp, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await startTestApp();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.reset());

const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

const matchBody = (overrides: Record<string, unknown> = {}) => {
  const merged = matchBodyBase(overrides);
  return {
    ...merged,
    endsAt:
      merged.endsAt ??
      new Date(Date.parse(merged.startsAt as string) + 2 * 3600 * 1000).toISOString(),
  };
};
const matchBodyBase = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  sourceLanguage: 'ko',
  regionCode: 'seoul-gangnam',
  startsAt: FUTURE,
  venueName: '강남 풋살파크',
  venueAddress: '서울 강남구 테헤란로 1',
  playersPerSide: 5,
  translations: {
    ko: {
      title: '서울 풋살장 5v5 매치',
      description: '초보자 환영',
      rules: '규정 풋살 룰',
      locationInstructions: '2번 출구',
      equipmentRequirements: '풋살화',
      cancellationPolicy: '24시간 전까지 무료 취소',
    },
  },
  ...overrides,
});

const post = (token: string, payload: unknown, headers: Record<string, string> = {}) =>
  ctx.app.inject({
    method: 'POST',
    url: '/v1/matches',
    headers: { ...bearer(token), ...headers },
    payload: payload as object,
  });
const get = (url: string, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: 'GET', url, headers });

describe('multilingual matches', () => {
  it('Korean-only match: Uzbek readers see the Korean original, flagged as fallback', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const created = await post(organizer.token, matchBody());
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect(created.headers.location).toBe(`/v1/matches/${id}`);

    const uz = (await get(`/v1/matches/${id}?lang=uz`)).json();
    expect(uz.title).toEqual({ text: '서울 풋살장 5v5 매치', locale: 'ko', isFallback: true });
    expect(uz.rules).toEqual({ text: '규정 풋살 룰', locale: 'ko', isFallback: true });

    const ko = (await get(`/v1/matches/${id}?lang=ko`)).json();
    expect(ko.title).toEqual({ text: '서울 풋살장 5v5 매치', locale: 'ko', isFallback: false });
  });

  it('shows each reader their own language when both exist', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const created = await post(
      organizer.token,
      matchBody({
        translations: {
          ko: { title: '서울 풋살장 5v5 매치' },
          uz: { title: 'Seul futzal maydonida 5x5 match' },
        },
      }),
    );
    const id = created.json().id as string;

    const koPlayer = await createUser(ctx, { preferredLanguage: 'ko' });
    const uzPlayer = await createUser(ctx, { preferredLanguage: 'uz' });
    expect((await get(`/v1/matches/${id}`, bearer(koPlayer.token))).json().title.text).toBe(
      '서울 풋살장 5v5 매치',
    );
    expect((await get(`/v1/matches/${id}`, bearer(uzPlayer.token))).json().title).toEqual({
      text: 'Seul futzal maydonida 5x5 match',
      locale: 'uz',
      isFallback: false,
    });
  });

  it('falls back per field: translated title, original rules', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const created = await post(
      organizer.token,
      matchBody({
        translations: {
          ko: { title: '제목', rules: '규칙 원문' },
          uz: { title: 'Sarlavha' },
        },
      }),
    );
    const view = (await get(`/v1/matches/${created.json().id}?lang=uz`)).json();
    expect(view.title).toMatchObject({ locale: 'uz', isFallback: false });
    expect(view.rules).toMatchObject({ text: '규칙 원문', locale: 'ko', isFallback: true });
    expect(view.description).toBeNull();
  });

  it('an Uzbek-source match is shown to Korean readers as the Uzbek original', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER', preferredLanguage: 'uz' });
    const created = await post(
      organizer.token,
      matchBody({
        sourceLanguage: 'uz',
        translations: { uz: { title: 'Toshkent jamoasi bilan match' } },
      }),
    );
    expect(created.statusCode).toBe(201);
    const view = (await get(`/v1/matches/${created.json().id}?lang=ko`)).json();
    expect(view.title).toEqual({
      text: 'Toshkent jamoasi bilan match',
      locale: 'uz',
      isFallback: true,
    });
  });

  it('same match, two users, only the display language differs', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const created = await post(
      organizer.token,
      matchBody({ translations: { ko: { title: '매치' }, uz: { title: 'Match' } } }),
    );
    const id = created.json().id as string;
    const ko = (await get(`/v1/matches/${id}?lang=ko`)).json();
    const uz = (await get(`/v1/matches/${id}?lang=uz`)).json();
    // Titles and region names are localized; everything else is identical for both readers.
    const { title: _k, region: _kr, ...koRest } = ko;
    const { title: _u, region: _ur, ...uzRest } = uz;
    expect(_kr.code).toBe(_ur.code);
    expect(koRest).toEqual(uzRest);
  });

  it('negotiates language: ?lang > account > Accept-Language > Korean', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const id = (
      await post(
        organizer.token,
        matchBody({ translations: { ko: { title: 'K' }, uz: { title: 'U' } } }),
      )
    ).json().id as string;
    const title = async (url: string, headers: Record<string, string> = {}) =>
      (await get(url, headers)).json().title.text;

    expect(await title(`/v1/matches/${id}`)).toBe('K');
    expect(await title(`/v1/matches/${id}`, { 'accept-language': 'uz-UZ' })).toBe('U');
    expect(await title(`/v1/matches/${id}`, { 'accept-language': 'en-US' })).toBe('K');
    const uzUser = await createUser(ctx, { preferredLanguage: 'uz' });
    expect(
      await title(`/v1/matches/${id}`, { ...bearer(uzUser.token), 'accept-language': 'ko' }),
    ).toBe('U');
    expect(await title(`/v1/matches/${id}?lang=ko`, bearer(uzUser.token))).toBe('K');
  });

  it('lists only upcoming matches, soonest first, localized', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const soon = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    await post(
      organizer.token,
      matchBody({ startsAt: FUTURE, translations: { ko: { title: 'later' } } }),
    );
    await post(
      organizer.token,
      matchBody({
        startsAt: soon,
        translations: { ko: { title: 'sooner' }, uz: { title: 'tezroq' } },
      }),
    );
    await ctx.handle.pool.query(
      `insert into matches (organizer_id, region_id, source_language, starts_at, ends_at, venue_name, players_per_side, fee_krw)
       values ($1, (select id from regions where code = 'seoul'), 'ko', now() - interval '1 day', now() - interval '22 hours', 'x', 5, 0)`,
      [organizer.id],
    );

    const res = await get('/v1/matches?lang=uz');
    expect(res.statusCode).toBe(200);
    const items = res.json().items as { title: { text: string; isFallback: boolean } }[];
    expect(items.map((i) => i.title.text)).toEqual(['tezroq', 'later']);
    expect(items.map((i) => i.title.isFallback)).toEqual([false, true]);
  });
});

describe('match authoring rules', () => {
  it('requires the source-language translation', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const res = await post(
      organizer.token,
      matchBody({ sourceLanguage: 'ko', translations: { uz: { title: 'Faqat o‘zbekcha' } } }),
      { 'accept-language': 'uz' },
    );
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({
      code: 'SOURCE_TRANSLATION_REQUIRED',
      message: 'Asl (asosiy) tilda yozilgan ma’lumot majburiy.',
    });
  });

  it('forbids players from creating matches', async () => {
    const player = await createUser(ctx);
    expect((await post(player.token, matchBody())).statusCode).toBe(403);
  });

  it('requires authentication', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/matches', payload: matchBody() });
    expect(res.statusCode).toBe(401);
  });

  it('only the organizer (or an admin) can edit, and edits replace translations', async () => {
    const owner = await createUser(ctx, { role: 'ORGANIZER' });
    const other = await createUser(ctx, { role: 'ORGANIZER' });
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const id = (await post(owner.token, matchBody())).json().id as string;
    const put = (token: string, payload: unknown) =>
      ctx.app.inject({
        method: 'PUT',
        url: `/v1/matches/${id}`,
        headers: bearer(token),
        payload: payload as object,
      });

    expect((await put(other.token, matchBody())).statusCode).toBe(403);

    const edited = await put(
      owner.token,
      matchBody({ translations: { ko: { title: '수정됨' }, uz: { title: 'Tahrirlandi' } } }),
    );
    expect(edited.statusCode).toBe(200);
    expect((await get(`/v1/matches/${id}?lang=uz`)).json().title.text).toBe('Tahrirlandi');
    // Old optional fields are gone: PUT is a full replace.
    expect((await get(`/v1/matches/${id}?lang=ko`)).json().rules).toBeNull();

    expect(
      (await put(admin.token, matchBody({ translations: { ko: { title: '관리자 수정' } } })))
        .statusCode,
    ).toBe(200);
  });

  it('exposes raw per-language texts to the organizer only', async () => {
    const owner = await createUser(ctx, { role: 'ORGANIZER' });
    const other = await createUser(ctx, { role: 'ORGANIZER' });
    const id = (await post(owner.token, matchBody())).json().id as string;
    const url = `/v1/matches/${id}/translations`;
    const res = await get(url, bearer(owner.token));
    expect(res.json()).toMatchObject({
      sourceLanguage: 'ko',
      translations: { ko: { title: '서울 풋살장 5v5 매치' } },
    });
    expect(res.json().translations).not.toHaveProperty('uz');
    expect((await get(url, bearer(other.token))).statusCode).toBe(403);
  });

  it('returns 404 for unknown matches and 400 for malformed ids', async () => {
    const missing = await get('/v1/matches/00000000-0000-4000-8000-000000000000', {
      'accept-language': 'uz',
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toEqual({ code: 'MATCH_NOT_FOUND', message: 'Match topilmadi.' });
    expect((await get('/v1/matches/not-a-uuid')).statusCode).toBe(400);
  });

  it('stores NFC-normalized text', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const res = await post(
      organizer.token,
      matchBody({ translations: { ko: { title: '매치'.normalize('NFD') } } }),
    );
    expect(res.json().title.text).toBe('매치');
  });
});
