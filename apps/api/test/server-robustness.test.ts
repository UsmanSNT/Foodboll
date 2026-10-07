import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inject } from 'vitest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createDb } from '../src/db/client';
import {
  cancelPendingTelegramNotifications,
  deliverTelegramNotifications,
} from '../src/services/notification-worker';
import { enqueueNotification } from '../src/services/notifications';
import { applyToMatch } from '../src/services/registrations';
import { LocalReceiptStorage } from '../src/storage';
import {
  authUser,
  bearer,
  createUser,
  FakeTelegram,
  insertMatch,
  startTestApp,
  TEST_BANK_CHAT_ID,
  TEST_BANK_SECRET,
  TEST_WEBHOOK_SECRET,
  type TestContext,
} from './helpers';

let ctx: TestContext;
let bot: FakeTelegram;
beforeAll(async () => {
  bot = new FakeTelegram();
  ctx = await startTestApp({}, { telegram: bot });
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await ctx.reset();
  bot.sent.length = 0;
  bot.fail = null;
  bot.delayMs = 0;
});

const hours = (n: number) => n * 3600 * 1000;
const query = (sql: string, params: unknown[] = []) =>
  ctx.handle.pool.query(sql, params).then((r) => r.rows as Record<string, unknown>[]);

const matchBody = (overrides: Record<string, unknown> = {}) => {
  const start = new Date(Date.now() + hours(24 * 10));
  return {
    sourceLanguage: 'ko',
    regionCode: 'seoul',
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + hours(2)).toISOString(),
    venueName: '테스트 풋살장',
    playersPerSide: 5,
    translations: { ko: { title: '서울 풋살' } },
    ...overrides,
  };
};
const put = (token: string, id: string, payload: object) =>
  ctx.app.inject({
    method: 'PUT',
    url: `/v1/matches/${id}`,
    headers: bearer(token),
    payload,
  });

describe('editing a match', () => {
  it('rejects a start time in the past and leaves the match untouched', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const id = await insertMatch(ctx, organizer.id);
    const before = (await query('select starts_at from matches where id = $1', [id]))[0];
    const past = new Date(Date.now() - hours(1));
    const res = await put(
      organizer.token,
      id,
      matchBody({
        startsAt: past.toISOString(),
        endsAt: new Date(past.getTime() + hours(2)).toISOString(),
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details).toEqual([{ path: 'startsAt', issue: 'too_small' }]);
    expect((await query('select starts_at from matches where id = $1', [id]))[0]).toEqual(before);
    expect((await put(organizer.token, id, matchBody())).statusCode).toBe(200);
  });

  it('ignores lapsed (expired, unpaid) holds when lowering the capacity', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const id = await insertMatch(ctx, organizer.id, { maxPlayers: 10 });
    const storage = new LocalReceiptStorage(ctx.config.receiptDir);
    for (let i = 0; i < 7; i++) {
      const player = await createUser(ctx);
      await applyToMatch(ctx.handle.db, storage, authUser(player), id);
    }
    // Live holds still block the cut ...
    expect(
      (await put(organizer.token, id, matchBody({ playersPerSide: 3, maxPlayers: 6 }))).statusCode,
    ).toBe(409);
    // ... but once every window has lapsed they no longer occupy seats.
    await query(`update registration_payments set due_at = now() - interval '1 hour'`);
    expect(
      (await put(organizer.token, id, matchBody({ playersPerSide: 3, maxPlayers: 6 }))).statusCode,
    ).toBe(200);
  });

  it('stores a MATCH_CHANGED notification for every player who holds a seat', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const id = await insertMatch(ctx, organizer.id);
    const storage = new LocalReceiptStorage(ctx.config.receiptDir);
    const applied = await createUser(ctx, { preferredLanguage: 'en' });
    const confirmed = await createUser(ctx, { preferredLanguage: 'ko' });
    const cancelled = await createUser(ctx);
    const lapsed = await createUser(ctx);
    const regs: Record<string, string> = {};
    for (const [name, user] of Object.entries({ applied, confirmed, cancelled, lapsed })) {
      regs[name] = await applyToMatch(ctx.handle.db, storage, authUser(user), id);
    }
    await query(`update match_registrations set status = 'CONFIRMED' where id = $1`, [
      regs.confirmed,
    ]);
    await query(`update match_registrations set status = 'CANCELLED' where id = $1`, [
      regs.cancelled,
    ]);
    await query(
      `update registration_payments set due_at = now() - interval '1 hour' where registration_id = $1`,
      [regs.lapsed],
    );
    const stored = async () =>
      query(
        `select user_id, title, channel from notifications where type = 'MATCH_CHANGED' order by created_at`,
      );

    // Only the description changes: nobody is notified.
    const row = (await query('select starts_at, ends_at from matches where id = $1', [id]))[0]!;
    const unchanged = {
      ...matchBody(),
      regionCode: 'seoul',
      venueName: '테스트 풋살장',
      startsAt: (row.starts_at as Date).toISOString(),
      endsAt: (row.ends_at as Date).toISOString(),
      translations: { ko: { title: '서울 풋살장 5v5 매치', description: 'new text' } },
    };
    expect((await put(organizer.token, id, unchanged)).statusCode).toBe(200);
    expect(await stored()).toEqual([]);

    // The venue changes: seat holders hear about it, once, in their language.
    expect(
      (await put(organizer.token, id, { ...unchanged, venueName: '다른 구장' })).statusCode,
    ).toBe(200);
    const rows = await stored();
    expect(rows.map((r) => r.user_id).sort()).toEqual([applied.id, confirmed.id].sort());
    const titles = Object.fromEntries(rows.map((r) => [r.user_id, r.title]));
    expect(titles[applied.id]).toBe('Match details changed');
    expect(titles[confirmed.id]).toBe('매치 정보 변경');
    // The inbox renders the new type.
    const inbox = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me/notifications',
      headers: bearer(applied.token),
    });
    expect(inbox.json().items[0]).toMatchObject({ type: 'MATCH_CHANGED' });
  });
});

describe('read parameter validation', () => {
  const get = (url: string) => ctx.app.inject({ method: 'GET', url });

  it('answers 400 for impossible dates instead of a database error', async () => {
    for (const date of ['0000-01-01', '0001-01-01', '1999-12-31', '2027-02-31', '2026-13-01']) {
      const res = await get(`/v1/matches?date=${date}`);
      expect(res.statusCode, date).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
    }
    expect((await get('/v1/matches?date=2027-02-28')).statusCode).toBe(200);
  });

  it('answers 400 for a player search containing a NUL byte', async () => {
    const { token } = await createUser(ctx);
    for (const q of ['%00', 'a%00b']) {
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/v1/players?q=${q}`,
        headers: bearer(token),
      });
      expect(res.statusCode, q).toBe(400);
    }
  });
});

describe('dev login', () => {
  const login = (payload: object) =>
    ctx.app.inject({ method: 'POST', url: '/v1/auth/dev-login', payload });

  it('creates players by default and only changes a role that is sent', async () => {
    expect((await login({ name: 'Boss', role: 'ADMIN' })).json().user.role).toBe('ADMIN');
    expect((await login({ name: 'Boss' })).json().user.role).toBe('ADMIN');
    expect((await login({ name: 'Newbie' })).json().user.role).toBe('PLAYER');
    expect((await login({ name: 'Boss', role: 'PLAYER' })).json().user.role).toBe('PLAYER');
  });

  it('is refused unless NODE_ENV is explicitly development or test', () => {
    const base = { DATABASE_URL: 'postgres://x', JWT_SECRET: 'a'.repeat(40), DEV_LOGIN: 'true' };
    expect(() => loadConfig(base)).toThrow(/NODE_ENV=development/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/DEV_LOGIN/);
    expect(loadConfig({ ...base, NODE_ENV: 'development' }).devLogin).toBe(true);
    expect(loadConfig({ ...base, NODE_ENV: 'test' }).devLogin).toBe(true);
  });
});

describe('configuration', () => {
  const base = { DATABASE_URL: 'postgres://x', JWT_SECRET: 'a'.repeat(40) };

  it('parses TRUST_PROXY as off, on, a hop count or an address list', () => {
    expect(loadConfig(base).trustProxy).toBe(false);
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ ...base, TRUST_PROXY: '2' }).trustProxy).toBe(2);
    expect(loadConfig({ ...base, TRUST_PROXY: '10.0.0.0/8, 127.0.0.1' }).trustProxy).toEqual([
      '10.0.0.0/8',
      '127.0.0.1',
    ]);
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'yes please' })).toThrow(/TRUST_PROXY/);
  });

  it('trusts exactly the configured number of proxy hops for the client address', async () => {
    const seen = async (trustProxy: number | boolean) => {
      const app = buildApp({ ...ctx.config, trustProxy }, ctx.handle.db);
      app.get('/__ip', async (request) => ({ ip: request.ip }));
      try {
        const res = await app.inject({
          method: 'GET',
          url: '/__ip',
          remoteAddress: '10.0.0.1',
          headers: { 'x-forwarded-for': '6.6.6.6, 7.7.7.7' },
        });
        return res.json().ip as string;
      } finally {
        await app.close();
      }
    };
    expect(await seen(false)).toBe('10.0.0.1');
    expect(await seen(1)).toBe('7.7.7.7');
    expect(await seen(true)).toBe('6.6.6.6');
  });

  it('reads ./.env for the real environment only, and the real environment wins', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'foodboll-env-'));
    writeFileSync(
      path.join(dir, '.env'),
      'DATABASE_URL=postgres://from-file\nJWT_SECRET=' +
        'f'.repeat(40) +
        '\nMATCH_FEE_KRW=12345\nPORT=4001\n',
    );
    const cwd = process.cwd();
    const saved = { ...process.env };
    try {
      process.chdir(dir);
      delete process.env.DATABASE_URL;
      delete process.env.JWT_SECRET;
      delete process.env.MATCH_FEE_KRW;
      process.env.PORT = '4999';
      // An injected env object never reads the file.
      expect(() => loadConfig({})).toThrow(/Invalid environment/);
      const config = loadConfig();
      expect(config.databaseUrl).toBe('postgres://from-file');
      expect(config.matchFeeKrw).toBe(12345);
      expect(config.port).toBe(4999);
    } finally {
      process.chdir(cwd);
      for (const key of ['DATABASE_URL', 'JWT_SECRET', 'MATCH_FEE_KRW', 'PORT']) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  });
});

describe('database connection errors', () => {
  it('survive a killed backend, idle or inside a transaction', async () => {
    const errors: Error[] = [];
    const handle = createDb(inject('databaseUrl'), { max: 2, onError: (e) => errors.push(e) });
    const kill = async (pid: number) =>
      ctx.handle.pool.query('select pg_terminate_backend($1)', [pid]);
    try {
      // Idle client
      const idle = await handle.pool.connect();
      const idlePid = (await idle.query('select pg_backend_pid() as pid')).rows[0].pid as number;
      idle.release();
      await kill(idlePid);
      await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0));

      // Checked-out client with an open transaction
      let txPid = 0;
      const tx = handle.db.transaction(async (t) => {
        txPid = ((await t.execute('select pg_backend_pid() as pid')) as { rows: { pid: number }[] })
          .rows[0]!.pid;
        await kill(txPid);
        await new Promise((resolve) => setTimeout(resolve, 200));
        await t.execute('select 1');
      });
      await expect(tx).rejects.toThrow();
      // The process is alive and the pool recovered.
      expect((await handle.pool.query('select 1 as one')).rows[0].one).toBe(1);
    } finally {
      await handle.close();
    }
  });
});

describe('Telegram webhook', () => {
  const hook = (app: TestContext, body: object) =>
    app.app.inject({
      method: 'POST',
      url: '/v1/integrations/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': TEST_WEBHOOK_SECRET },
      payload: body,
    });
  const channelPost = (text: string) => ({
    update_id: 1,
    channel_post: {
      message_id: 7,
      date: Math.floor(Date.now() / 1000),
      chat: { id: Number(TEST_BANK_CHAT_ID), type: 'channel' },
      text,
    },
  });
  const KST = 9 * 3600 * 1000;
  const alert = (memo: string) => {
    const at = new Date(Date.now() + KST);
    const p = (n: number) => String(n).padStart(2, '0');
    return `[KB]${p(at.getUTCMonth() + 1)}/${p(at.getUTCDate())} ${p(at.getUTCHours())}:${p(at.getUTCMinutes())} 123456**789 홍길동${memo} 입금 10,000 잔액 1,234,567`;
  };

  it('asks Telegram to redeliver when the bank ingest fails, and processes the redelivery once', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const matchId = await insertMatch(ctx, organizer.id);
    const player = await createUser(ctx);
    const reg = (
      await ctx.app.inject({
        method: 'POST',
        url: `/v1/matches/${matchId}/registrations`,
        headers: bearer(player.token),
      })
    ).json() as { id: string; payment: { referenceCode: string } };
    const update = channelPost(alert(reg.payment.referenceCode));

    await query('alter table bank_deposits rename to bank_deposits_off');
    try {
      expect((await hook(ctx, update)).statusCode).toBe(500);
    } finally {
      await query('alter table bank_deposits_off rename to bank_deposits');
    }
    expect((await hook(ctx, update)).statusCode).toBe(200);
    expect((await hook(ctx, update)).statusCode).toBe(200);
    expect(await query('select source from bank_deposits')).toEqual([{ source: 'TELEGRAM' }]);
    expect(
      (
        await query('select status from registration_payments where registration_id = $1', [reg.id])
      )[0]!.status,
    ).toBe('PAYMENT_CONFIRMED');
  });

  it('still acknowledges /start when the database write fails', async () => {
    await createUser(ctx, { telegramId: '321' });
    await query('alter table user_identities rename to user_identities_off');
    try {
      const res = await hook(ctx, {
        update_id: 2,
        message: {
          message_id: 1,
          from: { id: 321 },
          chat: { id: 321, type: 'private' },
          text: '/start',
        },
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await query('alter table user_identities_off rename to user_identities');
    }
  });
});

describe('logging', () => {
  it('never writes request data of a failed query to the log', async () => {
    const lines: string[] = [];
    const app = await startTestApp(
      { logLevel: 'info' },
      { logStream: { write: (line: string) => void lines.push(line) } },
    );
    try {
      await app.handle.pool.query('alter table bank_deposits rename to bank_deposits_off');
      const secret = 'SECRET-BANK-TEXT-홍길동-9f3a';
      try {
        const res = await app.app.inject({
          method: 'POST',
          url: '/v1/integrations/bank-notifications',
          headers: { authorization: `Bearer ${TEST_BANK_SECRET}` },
          payload: { text: `[KB]01/01 00:00 123456**789 ${secret} 입금 10,000 잔액 1` },
        });
        expect(res.statusCode).toBe(500);
      } finally {
        await app.handle.pool.query('alter table bank_deposits_off rename to bank_deposits');
      }
      const log = lines.join('');
      expect(log).toContain('Unhandled error');
      expect(log).not.toContain('SECRET-BANK');
      expect(log).not.toContain('홍길동');
      expect(log).not.toContain(TEST_BANK_SECRET);
    } finally {
      await app.close();
    }
  });
});

describe('Telegram notification worker', () => {
  const queue = async (telegramId: string) => {
    const user = await createUser(ctx, { telegramId, telegramStarted: true });
    await enqueueNotification(ctx.handle.db, { userId: user.id, type: 'PAYMENT_CONFIRMED' });
    return user;
  };

  it('holds no transaction while it talks to Telegram', async () => {
    await queue('1');
    let idleInTransaction = -1;
    bot.delayMs = 1;
    const original = bot.sendMessage.bind(bot);
    bot.sendMessage = async (chatId, text) => {
      idleInTransaction = (
        await query(
          `select count(*)::int as n from pg_stat_activity
            where datname = current_database() and state like 'idle in transaction%'`,
        )
      )[0]!.n as number;
      return original(chatId, text);
    };
    try {
      expect((await deliverTelegramNotifications(ctx.handle.db, bot)).sent).toBe(1);
    } finally {
      bot.sendMessage = original;
    }
    expect(idleInTransaction).toBe(0);
  });

  it('keeps a claimed row leased, so another worker run does not send it again', async () => {
    await queue('2');
    let second = { sent: -1, retrying: 0, failed: 0 };
    const original = bot.sendMessage.bind(bot);
    bot.sendMessage = async (chatId, text) => {
      second = await deliverTelegramNotifications(ctx.handle.db, bot);
      return original(chatId, text);
    };
    try {
      expect((await deliverTelegramNotifications(ctx.handle.db, bot)).sent).toBe(1);
    } finally {
      bot.sendMessage = original;
    }
    expect(second.sent).toBe(0);
    expect(bot.sent).toHaveLength(1);
  });

  it('does not send what was queued before the user opted out', async () => {
    const user = await queue('3');
    await query('update users set telegram_started_at = null where id = $1', [user.id]);
    expect((await deliverTelegramNotifications(ctx.handle.db, bot)).sent).toBe(0);
    expect(bot.sent).toEqual([]);
    expect(
      await query(`select status, last_error from notifications where channel = 'TELEGRAM'`),
    ).toEqual([{ status: 'FAILED', last_error: 'telegram notifications off' }]);
  });

  it('cancels a row that is waiting for a retry when the user sends /stop', async () => {
    const user = await queue('4');
    await query(
      `update notifications set next_attempt_at = now() + interval '5 minutes', attempts = 1
        where channel = 'TELEGRAM'`,
    );
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/integrations/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': TEST_WEBHOOK_SECRET },
      payload: {
        update_id: 3,
        message: {
          message_id: 1,
          from: { id: 4 },
          chat: { id: 4, type: 'private' },
          text: '/stop',
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect((await query(`select status from notifications where channel = 'TELEGRAM'`))[0]).toEqual(
      { status: 'FAILED' },
    );
    await cancelPendingTelegramNotifications(ctx.handle.db, user.id);
  });

  it('records a delivery even if the clock used by the caller is shifted', async () => {
    await queue('5');
    const later = new Date(Date.now() + hours(1));
    expect((await deliverTelegramNotifications(ctx.handle.db, bot, later)).sent).toBe(1);
    expect(
      (
        await query(`select status, next_attempt_at from notifications where channel = 'TELEGRAM'`)
      )[0],
    ).toEqual({
      status: 'SENT',
      next_attempt_at: null,
    });
  });
});
