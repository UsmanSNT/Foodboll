import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { verifyTelegramLogin } from '../src/services/auth';
import {
  bearer,
  createUser,
  signToken,
  startTestApp,
  telegramLoginPayload,
  TEST_BOT_TOKEN,
  type TestContext,
} from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await startTestApp();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.reset());

const login = (payload: object, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: 'POST', url: '/v1/auth/telegram', headers, payload });
const me = (token: string) =>
  ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(token) });
const now = () => Math.floor(Date.now() / 1000);

describe('Telegram login', () => {
  it('creates an account on first login and signs the user in', async () => {
    const res = await login(
      telegramLoginPayload({
        id: 1001,
        first_name: 'Aziz',
        last_name: 'Karimov',
        username: 'aziz_k',
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toMatchObject({
      displayName: 'Aziz Karimov',
      role: 'PLAYER',
      preferredLanguage: null,
      homeRegion: null,
    });
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);
    expect((await me(body.accessToken)).json().id).toBe(body.user.id);
  });

  it('logs the same person into the same account every time', async () => {
    const first = (
      await login(telegramLoginPayload({ id: 1002, first_name: 'Min', auth_date: now() - 5 }))
    ).json();
    const second = (
      await login(telegramLoginPayload({ id: 1002, first_name: 'Min (renamed)', auth_date: now() }))
    ).json();
    expect(second.user.id).toBe(first.user.id);
    expect(second.user.displayName).toBe('Min'); // a later Telegram rename does not overwrite the profile
    const { rows } = await ctx.handle.pool.query('select count(*)::int as n from users');
    expect(rows[0].n).toBe(1);
  });

  it('survives two simultaneous first logins', async () => {
    const results = await Promise.all(
      [now() - 3, now() - 2, now() - 1].map((auth_date) =>
        login(telegramLoginPayload({ id: 1003, first_name: 'Race', auth_date })),
      ),
    );
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(new Set(results.map((r) => r.json().user.id)).size).toBe(1);
    expect((await ctx.handle.pool.query('select count(*)::int as n from users')).rows[0].n).toBe(1);
  });

  it('rejects tampered, forged, stale, future and replayed payloads', async () => {
    const good = telegramLoginPayload({ id: 1004, first_name: 'Eve' });
    expect((await login({ ...good, first_name: 'Admin' })).statusCode).toBe(401); // field changed after signing
    expect((await login({ ...good, id: 1005 })).statusCode).toBe(401); // id swapped (account takeover attempt)
    expect(
      (await login(telegramLoginPayload({ id: 1004 }, 'another-bot-token-entirely-123456')))
        .statusCode,
    ).toBe(401);
    expect(
      (await login(telegramLoginPayload({ id: 1004, auth_date: now() - 3600 }))).statusCode,
    ).toBe(401); // stale
    expect(
      (await login(telegramLoginPayload({ id: 1004, auth_date: now() + 3600 }))).statusCode,
    ).toBe(401); // future
    expect((await login({ ...good, hash: 'a'.repeat(64) })).statusCode).toBe(401);

    const ok = await login(good);
    expect(ok.statusCode).toBe(200);
    const replay = await login(good);
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe('TELEGRAM_LOGIN_INVALID');
  });

  it('rejects malformed payloads before verifying them', async () => {
    const good = telegramLoginPayload({ id: 1006 });
    const { hash: _hash, ...noHash } = good;
    expect((await login(noHash)).statusCode).toBe(400);
    expect((await login({ ...good, hash: 'zz' })).statusCode).toBe(400);
    expect((await login({ ...good, extra: 'field' })).statusCode).toBe(400);
    expect((await login({ ...good, id: 'abc' })).statusCode).toBe(400);
    expect((await login({})).statusCode).toBe(400);
  });

  it('accepts string-typed fields as the widget sends them through a redirect', async () => {
    const signed = telegramLoginPayload({ id: 1007, first_name: 'Str' });
    const asStrings = Object.fromEntries(Object.entries(signed).map(([k, v]) => [k, String(v)]));
    expect((await login(asStrings)).statusCode).toBe(200);
  });

  it('cleans untrusted display names', async () => {
    const res = await login(
      telegramLoginPayload({
        id: 1008,
        first_name: '\u0000Bad\u0007Name‮'.slice(0, 20),
        last_name: 'x'.repeat(200),
      }),
    );
    expect(res.statusCode).toBe(200);
    const name = res.json().user.displayName as string;
    expect(name.length).toBeLessThanOrEqual(100);
    // eslint-disable-next-line no-control-regex
    expect(name).not.toMatch(/[\u0000-\u001f]/);
    const fallback = await login(telegramLoginPayload({ id: 1009 }));
    expect(fallback.json().user.displayName).toBe('Player');
    const byUsername = await login(telegramLoginPayload({ id: 1010, username: 'only_username' }));
    expect(byUsername.json().user.displayName).toBe('only_username');
  });

  it('is unavailable when no bot is configured', async () => {
    const bare = await startTestApp({ telegram: null });
    try {
      const res = await bare.app.inject({
        method: 'POST',
        url: '/v1/auth/telegram',
        payload: telegramLoginPayload({ id: 1 }),
      });
      expect(res.statusCode).toBe(404);
      expect((await bare.app.inject({ method: 'GET', url: '/v1/auth/config' })).json()).toEqual({
        telegramBotUsername: null,
        devLogin: true,
      });
    } finally {
      await bare.close();
    }
  });

  it('exposes the bot username for the sign-in button', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/auth/config' })).json()).toEqual({
      telegramBotUsername: 'foodboll_test_bot',
      devLogin: true,
    });
  });

  it('rate limits login attempts', async () => {
    const limited = await startTestApp({ loginRateLimitPerMinute: 10 });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 12; i++) {
        codes.push(
          (
            await limited.app.inject({
              method: 'POST',
              url: '/v1/auth/telegram',
              payload: { nope: i },
            })
          ).statusCode,
        );
      }
      expect(codes.slice(0, 10).every((c) => c === 400)).toBe(true);
      expect(codes.slice(10)).toEqual([429, 429]);
    } finally {
      await limited.close();
    }
  });
});

describe('verifyTelegramLogin', () => {
  it('matches the algorithm in the Telegram documentation', () => {
    const payload = telegramLoginPayload({ id: 42, first_name: 'Doc', auth_date: 1_700_000_000 });
    const input = payload as unknown as Parameters<typeof verifyTelegramLogin>[1];
    expect(verifyTelegramLogin(TEST_BOT_TOKEN, input, 1_700_000_100)).toBe(true);
    expect(verifyTelegramLogin(TEST_BOT_TOKEN, input, 1_700_000_000 + 601)).toBe(false);
    expect(verifyTelegramLogin('x'.repeat(30), input, 1_700_000_100)).toBe(false);
  });
});

describe('sessions', () => {
  it('logout revokes only the current session', async () => {
    const user = await createUser(ctx);
    const other = (await login(telegramLoginPayload({ id: 2001 }))).json();
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/v1/auth/logout',
          headers: bearer(other.accessToken),
        })
      ).statusCode,
    ).toBe(200);
    expect((await me(other.accessToken)).statusCode).toBe(401);
    expect((await me(user.token)).statusCode).toBe(200);
  });

  it('logout-all revokes every session of the user', async () => {
    const a = (await login(telegramLoginPayload({ id: 2002, auth_date: now() - 2 }))).json();
    const b = (await login(telegramLoginPayload({ id: 2002, auth_date: now() - 1 }))).json();
    expect((await me(a.accessToken)).statusCode).toBe(200);
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/logout-all',
      headers: bearer(a.accessToken),
    });
    expect((await me(a.accessToken)).statusCode).toBe(401);
    expect((await me(b.accessToken)).statusCode).toBe(401);
  });

  it('refuses expired sessions, tokens without a session, and sessions of another user', async () => {
    const user = await createUser(ctx);
    const stranger = await createUser(ctx);
    await ctx.handle.pool.query(
      `update auth_sessions set expires_at = now() - interval '1 second' where id = $1`,
      [user.sessionId],
    );
    expect((await me(user.token)).statusCode).toBe(401);

    expect((await me(await signToken(ctx.config, stranger.id))).statusCode).toBe(401); // jti unknown
    // A valid session id presented with someone else's subject must not authenticate.
    expect(
      (await me(await signToken(ctx.config, user.id, { jti: stranger.sessionId }))).statusCode,
    ).toBe(401);
  });

  it('removing the user removes their sessions', async () => {
    const user = await createUser(ctx);
    await ctx.handle.pool.query('delete from users where id = $1', [user.id]);
    expect((await me(user.token)).statusCode).toBe(401);
  });
});

describe('development login', () => {
  const dev = (app: TestContext, payload: object) =>
    app.app.inject({ method: 'POST', url: '/v1/auth/dev-login', payload });

  it('signs in as a named user with a chosen role when enabled', async () => {
    const res = await dev(ctx, { name: 'Dev Admin', role: 'ADMIN' });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ displayName: 'Dev Admin', role: 'ADMIN' });
    const again = await dev(ctx, { name: 'dev admin', role: 'ORGANIZER' });
    expect(again.json().user).toMatchObject({ id: res.json().user.id, role: 'ORGANIZER' });
  });

  it('does not exist when disabled', async () => {
    const off = await startTestApp({ devLogin: false });
    try {
      expect((await dev(off, { name: 'x', role: 'ADMIN' })).statusCode).toBe(404);
    } finally {
      await off.close();
    }
  });

  it('refuses to start in production with dev login enabled', () => {
    const base = { DATABASE_URL: 'postgres://x', JWT_SECRET: 'a'.repeat(40) };
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', DEV_LOGIN: 'true' })).toThrow(
      /DEV_LOGIN/,
    );
    expect(loadConfig({ ...base, NODE_ENV: 'development', DEV_LOGIN: 'true' }).devLogin).toBe(true);
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).devLogin).toBe(false);
  });

  it('requires all Telegram settings together', () => {
    const base = { DATABASE_URL: 'postgres://x', JWT_SECRET: 'a'.repeat(40) };
    expect(() => loadConfig({ ...base, TELEGRAM_BOT_TOKEN: '1'.repeat(30) })).toThrow(/together/);
    const full = loadConfig({
      ...base,
      TELEGRAM_BOT_TOKEN: '123456789:abcdefghijklmnop',
      TELEGRAM_BOT_USERNAME: 'foodboll_bot',
      TELEGRAM_WEBHOOK_SECRET: 'secret-secret-secret',
    });
    expect(full.telegram?.botUsername).toBe('foodboll_bot');
    expect(loadConfig(base).telegram).toBeNull();
  });
});
