import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createUser, startTestApp, type TestContext } from './helpers';

describe('http hardening', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestApp();
  });
  afterAll(() => ctx.close());

  it('returns localized JSON for malformed bodies without leaking internals', async () => {
    await ctx.reset();
    const { token } = await createUser(ctx);
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/me/language',
      headers: { ...bearer(token), 'content-type': 'application/json', 'accept-language': 'uz' },
      payload: '{"preferredLanguage":',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Kiritilgan ma’lumotlarni tekshiring.',
    });
    expect(res.body).not.toMatch(/SyntaxError|node_modules/);
  });

  it('returns localized 404 for unknown routes', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/nope',
      headers: { 'accept-language': 'uz' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toEqual({
      code: 'NOT_FOUND',
      message: 'So‘ralgan ma’lumot topilmadi.',
    });
  });

  it('sets security headers and honours the CORS allow-list', async () => {
    const allowed = await ctx.app.inject({
      method: 'GET',
      url: '/v1/languages',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(allowed.headers['x-content-type-options']).toBe('nosniff');
    const denied = await ctx.app.inject({
      method: 'GET',
      url: '/v1/languages',
      headers: { origin: 'https://evil.example' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate limits with a localized 429', async () => {
    const limited = await startTestApp({ rateLimitPerMinute: 3 });
    try {
      const statuses: number[] = [];
      let last = null;
      for (let i = 0; i < 5; i++) {
        last = await limited.app.inject({
          method: 'GET',
          url: '/v1/languages',
          headers: { 'accept-language': 'uz' },
        });
        statuses.push(last.statusCode);
      }
      expect(statuses).toEqual([200, 200, 200, 429, 429]);
      expect(last?.json().error).toEqual({
        code: 'RATE_LIMITED',
        message: 'So‘rovlar juda ko‘p. Birozdan so‘ng qayta urinib ko‘ring.',
      });
    } finally {
      await limited.close();
    }
  });
});

describe('upload rate limit', () => {
  it('caps receipt uploads per client independently of the global limit', async () => {
    const limited = await startTestApp({ uploadRateLimitPerMinute: 2 });
    try {
      const { token } = await createUser(limited);
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        const res = await limited.app.inject({
          method: 'PUT',
          url: '/v1/registrations/00000000-0000-4000-8000-000000000000/receipt',
          headers: { ...bearer(token), 'content-type': 'image/png' },
          payload: Buffer.from([0x89, 0x50]),
        });
        statuses.push(res.statusCode);
      }
      expect(statuses.slice(2)).toEqual([429, 429]);
    } finally {
      await limited.close();
    }
  });
});
