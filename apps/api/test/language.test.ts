import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createUser, signToken, startTestApp, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await startTestApp();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.reset());

const get = (url: string, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: 'GET', url, headers });

describe('GET /v1/languages', () => {
  it('lists enabled languages with native names, in display order', async () => {
    const res = await get('/v1/languages');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [
        { code: 'ko', nativeName: '한국어', englishName: 'Korean' },
        { code: 'uz', nativeName: 'O‘zbekcha', englishName: 'Uzbek' },
        { code: 'en', nativeName: 'English', englishName: 'English' },
      ],
    });
  });

  it('omits disabled languages', async () => {
    await ctx.handle.pool.query(`update languages set enabled = false where code = 'uz'`);
    try {
      const res = await get('/v1/languages');
      expect(res.json().items.map((l: { code: string }) => l.code)).toEqual(['ko', 'en']);
    } finally {
      await ctx.handle.pool.query(`update languages set enabled = true where code = 'uz'`);
    }
  });
});

describe('authentication', () => {
  it('returns a localized 401 without a token', async () => {
    const uz = await get('/v1/me', { 'accept-language': 'uz-UZ,ko;q=0.5' });
    expect(uz.statusCode).toBe(401);
    expect(uz.headers['content-language']).toBe('uz');
    expect(uz.json()).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Tizimga kirish talab qilinadi.' },
    });
    const ko = await get('/v1/me', { 'accept-language': 'ru-RU' }); // unsupported: Korean default
    expect(ko.json().error.message).toBe('로그인이 필요합니다.');
    const en = await get('/v1/me', { 'accept-language': 'en-US' });
    expect(en.json().error).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Please log in to continue.',
    });
  });

  it('rejects tokens with the wrong secret, issuer, audience, or expiry', async () => {
    const { id } = await createUser(ctx);
    const bad = await Promise.all([
      signToken(ctx.config, id, { secret: 'another-secret-another-secret-123456' }),
      signToken(ctx.config, id, { issuer: 'evil' }),
      signToken(ctx.config, id, { audience: 'other' }),
      signToken(ctx.config, id, { expiresIn: '-1h' }),
    ]);
    for (const token of bad) {
      expect((await get('/v1/me', bearer(token))).statusCode).toBe(401);
    }
    expect((await get('/v1/me', { authorization: 'Bearer nonsense' })).statusCode).toBe(401);
    expect((await get('/v1/me', { authorization: 'Basic abc' })).statusCode).toBe(401);
  });

  it('rejects a valid token for a user that no longer exists', async () => {
    const token = await signToken(ctx.config, '00000000-0000-4000-8000-000000000000');
    expect((await get('/v1/me', bearer(token))).statusCode).toBe(401);
  });
});

describe('user language', () => {
  it('starts unset and falls back to the device language header', async () => {
    const { token } = await createUser(ctx);
    const res = await get('/v1/me', { ...bearer(token), 'accept-language': 'uz' });
    expect(res.json()).toMatchObject({ preferredLanguage: null, effectiveLanguage: 'uz' });
  });

  it('saves the choice to the account and remembers it across sessions', async () => {
    const { token } = await createUser(ctx);
    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/me/language',
      headers: bearer(token),
      payload: { preferredLanguage: 'uz', deviceLocale: 'uz-Latn-UZ' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toMatchObject({ preferredLanguage: 'uz', effectiveLanguage: 'uz' });

    // A "new session" with a Korean device header still gets Uzbek: the account wins.
    const me = await get('/v1/me', { ...bearer(token), 'accept-language': 'ko-KR' });
    expect(me.json()).toMatchObject({ preferredLanguage: 'uz', effectiveLanguage: 'uz' });
    expect(me.headers['content-language']).toBe('uz');
  });

  it('can be changed again later (never locked)', async () => {
    const { token } = await createUser(ctx, { preferredLanguage: 'uz' });
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/me/language',
      headers: bearer(token),
      payload: { preferredLanguage: 'ko' },
    });
    expect(res.json()).toMatchObject({ preferredLanguage: 'ko' });
  });

  it('an explicit ?lang= overrides the account for that request only', async () => {
    const { token } = await createUser(ctx, { preferredLanguage: 'ko' });
    const res = await get('/v1/me?lang=uz', bearer(token));
    expect(res.json()).toMatchObject({ preferredLanguage: 'ko', effectiveLanguage: 'uz' });
  });

  it('device locale alone does not set the preferred language', async () => {
    const { token, id } = await createUser(ctx);
    await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/me/language',
      headers: bearer(token),
      payload: { deviceLocale: 'uz-UZ' },
    });
    const { rows } = await ctx.handle.pool.query(
      'select preferred_language, device_locale from users where id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ preferred_language: null, device_locale: 'uz-UZ' });
  });

  it.each([
    ['unsupported language', { preferredLanguage: 'fr' }],
    ['empty body', {}],
    ['nationality field', { preferredLanguage: 'uz', nationality: 'UZ' }],
    ['bad device locale', { deviceLocale: "uz'; drop table users;--" }],
  ])('rejects %s with a localized 400', async (_name, payload) => {
    const { token } = await createUser(ctx);
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/me/language',
      headers: { ...bearer(token), 'accept-language': 'uz' },
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Kiritilgan ma’lumotlarni tekshiring.',
    });
  });

  it('refuses to select a disabled language', async () => {
    await ctx.handle.pool.query(`update languages set enabled = false where code = 'uz'`);
    try {
      const { token } = await createUser(ctx);
      const res = await ctx.app.inject({
        method: 'PATCH',
        url: '/v1/me/language',
        headers: bearer(token),
        payload: { preferredLanguage: 'uz' },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('LANGUAGE_NOT_SUPPORTED');
    } finally {
      await ctx.handle.pool.query(`update languages set enabled = true where code = 'uz'`);
    }
  });
});

describe('admin: user languages', () => {
  it('shows preferred language and device language, and filters by language', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN', preferredLanguage: 'ko' });
    await createUser(ctx, { displayName: 'Aziz', preferredLanguage: 'uz', deviceLocale: 'uz-UZ' });
    await createUser(ctx, {
      displayName: 'Minjun',
      preferredLanguage: 'ko',
      deviceLocale: 'ko-KR',
    });
    await createUser(ctx, { displayName: 'New', preferredLanguage: null, deviceLocale: 'uz-UZ' });

    const all = await get('/v1/admin/users', bearer(admin.token));
    expect(all.statusCode).toBe(200);
    expect(all.json().items).toHaveLength(4);
    expect(all.json().items[0]).not.toHaveProperty('nationality');

    const uz = await get('/v1/admin/users?language=uz', bearer(admin.token));
    expect(uz.json().items).toEqual([
      expect.objectContaining({
        displayName: 'Aziz',
        preferredLanguage: 'uz',
        deviceLocale: 'uz-UZ',
      }),
    ]);

    const none = await get('/v1/admin/users?language=none', bearer(admin.token));
    expect(none.json().items).toEqual([
      expect.objectContaining({
        displayName: 'New',
        preferredLanguage: null,
        deviceLocale: 'uz-UZ',
      }),
    ]);
  });

  it('is forbidden for non-admins', async () => {
    const player = await createUser(ctx);
    expect((await get('/v1/admin/users', bearer(player.token))).statusCode).toBe(403);
  });
});
