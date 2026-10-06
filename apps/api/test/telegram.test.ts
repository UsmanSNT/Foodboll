import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTelegramClient, TelegramApiError } from '../src/integrations/telegram';
import { deliverTelegramNotifications } from '../src/services/notification-worker';
import { enqueueNotification } from '../src/services/notifications';
import {
  bearer,
  createUser,
  FakeTelegram,
  startTestApp,
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

const webhook = (body: unknown, secret: string | null = TEST_WEBHOOK_SECRET) =>
  ctx.app.inject({
    method: 'POST',
    url: '/v1/integrations/telegram/webhook',
    headers: secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret },
    payload: body as object,
  });
const privateMessage = (id: number, text: string, extra: Record<string, unknown> = {}) => ({
  update_id: 1,
  message: {
    message_id: 1,
    from: { id, language_code: 'uz', ...extra },
    chat: { id, type: 'private' },
    text,
  },
});
const started = async (userId: string) =>
  (
    await ctx.handle.pool.query(
      'select telegram_started_at is not null as s from users where id = $1',
      [userId],
    )
  ).rows[0].s as boolean;

describe('webhook security', () => {
  it('rejects calls without the secret Telegram was told to send', async () => {
    expect((await webhook(privateMessage(1, '/start'), null)).statusCode).toBe(401);
    expect(
      (await webhook(privateMessage(1, '/start'), 'wrong-secret-wrong-secret')).statusCode,
    ).toBe(401);
    expect((await webhook(privateMessage(1, '/start'), 'x')).statusCode).toBe(401);
    expect(bot.sent).toEqual([]);
  });

  it('is not available when the bot is not configured', async () => {
    const bare = await startTestApp({ telegram: null });
    try {
      const res = await bare.app.inject({
        method: 'POST',
        url: '/v1/integrations/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': TEST_WEBHOOK_SECRET },
        payload: {},
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await bare.close();
    }
  });
});

describe('/start and /stop', () => {
  it('turns notifications on for a user who logged in with Telegram, replying in their language', async () => {
    const user = await createUser(ctx, { telegramId: '777', preferredLanguage: 'uz' });
    expect((await webhook(privateMessage(777, '/start app'))).statusCode).toBe(200);
    expect(await started(user.id)).toBe(true);
    expect(bot.sent).toEqual([
      {
        chatId: '777',
        text: 'Bildirishnomalar yoqildi. Endi to‘lov va ishtirok tasdiqlanishi haqidagi xabarlar shu yerga yuboriladi.',
      },
    ]);
    const status = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me/telegram',
      headers: bearer(user.token),
    });
    expect(status.json()).toEqual({
      available: true,
      linked: true,
      notificationsEnabled: true,
      botLink: 'https://t.me/foodboll_test_bot?start=app',
    });
  });

  it('asks unknown people to log in through the app first (in their Telegram language)', async () => {
    await webhook(privateMessage(888, '/start', { language_code: 'ko' }));
    expect(bot.sent).toEqual([
      { chatId: '888', text: '먼저 앱에서 텔레그램으로 로그인한 뒤 다시 /start 를 보내주세요.' },
    ]);
    expect((await ctx.handle.pool.query('select count(*)::int as n from users')).rows[0].n).toBe(0);
  });

  it('/stop turns them off again', async () => {
    const user = await createUser(ctx, {
      telegramId: '999',
      telegramStarted: true,
      preferredLanguage: 'ko',
    });
    await webhook(privateMessage(999, '/stop'));
    expect(await started(user.id)).toBe(false);
    expect(bot.sent[0]?.text).toBe('알림을 껐습니다. 다시 받으려면 /start 를 보내주세요.');
  });

  it('ignores groups, other commands, non-text and garbage, and always answers 200', async () => {
    const user = await createUser(ctx, { telegramId: '555' });
    const group = {
      message: {
        message_id: 1,
        from: { id: 555 },
        chat: { id: -100, type: 'supergroup' },
        text: '/start',
      },
    };
    for (const body of [
      group,
      privateMessage(555, 'hello'),
      privateMessage(555, '/help'),
      { update_id: 2 },
      { message: 'nope' },
      [],
    ]) {
      expect((await webhook(body)).statusCode).toBe(200);
    }
    expect(await started(user.id)).toBe(false);
    expect(bot.sent).toEqual([]);
  });

  it('still acknowledges when replying to the user fails', async () => {
    const user = await createUser(ctx, { telegramId: '444' });
    bot.fail = () => new Error('boom');
    expect((await webhook(privateMessage(444, '/start'))).statusCode).toBe(200);
    expect(await started(user.id)).toBe(true);
  });

  it('reports availability to users who never used Telegram', async () => {
    const user = await createUser(ctx);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me/telegram',
      headers: bearer(user.token),
    });
    expect(res.json()).toMatchObject({ linked: false, notificationsEnabled: false });
  });
});

describe('delivery worker', () => {
  const queue = async (userId: string) =>
    enqueueNotification(ctx.handle.db, { userId, type: 'PAYMENT_CONFIRMED' });
  const state = async (userId: string) =>
    (
      await ctx.handle.pool.query(
        `select status, attempts, last_error, next_attempt_at from notifications where user_id = $1 and channel = 'TELEGRAM'`,
        [userId],
      )
    ).rows[0] as {
      status: string;
      attempts: number;
      last_error: string | null;
      next_attempt_at: Date | null;
    };

  it('sends the message in the recipient language to their Telegram chat', async () => {
    const user = await createUser(ctx, {
      telegramId: '31',
      telegramStarted: true,
      preferredLanguage: 'uz',
    });
    await queue(user.id);
    expect(await deliverTelegramNotifications(ctx.handle.db, bot)).toEqual({
      sent: 1,
      retrying: 0,
      failed: 0,
    });
    expect(bot.sent).toEqual([
      { chatId: '31', text: 'To‘lov tasdiqlandi\nTo‘lovingiz tasdiqlandi.' },
    ]);
    expect((await state(user.id)).status).toBe('SENT');
    // Nothing left to do on the next tick.
    expect(await deliverTelegramNotifications(ctx.handle.db, bot)).toEqual({
      sent: 0,
      retrying: 0,
      failed: 0,
    });
  });

  it('stops messaging a user who blocked the bot', async () => {
    const user = await createUser(ctx, { telegramId: '32', telegramStarted: true });
    await queue(user.id);
    bot.fail = () => new TelegramApiError(403, 'Forbidden: bot was blocked by the user');
    expect(await deliverTelegramNotifications(ctx.handle.db, bot)).toMatchObject({ failed: 1 });
    expect((await state(user.id)).status).toBe('FAILED');
    expect(await started(user.id)).toBe(false);
    // The in-app inbox is unaffected.
    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: '/v1/me/notifications',
          headers: bearer(user.token),
        })
      ).json().items,
    ).toHaveLength(1);
  });

  it('retries transient failures with backoff, then gives up', async () => {
    const user = await createUser(ctx, { telegramId: '33', telegramStarted: true });
    await queue(user.id);
    bot.fail = () => new TelegramApiError(502, 'Bad Gateway');
    const t0 = new Date();
    expect(await deliverTelegramNotifications(ctx.handle.db, bot, t0)).toMatchObject({
      retrying: 1,
    });
    let s = await state(user.id);
    expect(s).toMatchObject({ status: 'PENDING', attempts: 1, last_error: 'Bad Gateway' });
    expect((s.next_attempt_at?.getTime() ?? 0) - t0.getTime()).toBe(30_000);

    // Not due yet: nothing happens.
    expect(
      await deliverTelegramNotifications(ctx.handle.db, bot, new Date(t0.getTime() + 10_000)),
    ).toEqual({ sent: 0, retrying: 0, failed: 0 });

    let clock = t0.getTime();
    for (let attempt = 2; attempt <= 5; attempt++) {
      clock += 3_700_000;
      expect(await deliverTelegramNotifications(ctx.handle.db, bot, new Date(clock))).toMatchObject(
        { retrying: 1 },
      );
    }
    clock += 3_700_000;
    expect(await deliverTelegramNotifications(ctx.handle.db, bot, new Date(clock))).toMatchObject({
      failed: 1,
    });
    s = await state(user.id);
    expect(s).toMatchObject({ status: 'FAILED', attempts: 6 });
    expect(await started(user.id)).toBe(true); // a flaky network is not "blocked"
  });

  it('delivers after a transient failure clears', async () => {
    const user = await createUser(ctx, { telegramId: '34', telegramStarted: true });
    await queue(user.id);
    bot.fail = () => new TelegramApiError(0, 'TimeoutError');
    const t0 = new Date();
    await deliverTelegramNotifications(ctx.handle.db, bot, t0);
    bot.fail = null;
    await deliverTelegramNotifications(ctx.handle.db, bot, new Date(t0.getTime() + 60_000));
    expect((await state(user.id)).status).toBe('SENT');
    expect(bot.sent).toHaveLength(1);
  });

  it('honours Telegram rate limiting (retry_after)', async () => {
    const user = await createUser(ctx, { telegramId: '35', telegramStarted: true });
    await queue(user.id);
    bot.fail = () => new TelegramApiError(429, 'Too Many Requests', 17);
    const t0 = new Date();
    await deliverTelegramNotifications(ctx.handle.db, bot, t0);
    expect(((await state(user.id)).next_attempt_at?.getTime() ?? 0) - t0.getTime()).toBe(17_000);
  });

  it('never sends a notification twice when workers overlap', async () => {
    const users = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        createUser(ctx, { telegramId: String(100 + i), telegramStarted: true }),
      ),
    );
    for (const u of users) await queue(u.id);
    bot.delayMs = 15;
    const results = await Promise.all(
      [1, 2, 3].map(() => deliverTelegramNotifications(ctx.handle.db, bot, new Date(), 5)),
    );
    expect(results.reduce((sum, r) => sum + r.sent, 0)).toBe(bot.sent.length);
    expect(new Set(bot.sent.map((m) => m.chatId)).size).toBe(bot.sent.length);
    await deliverTelegramNotifications(ctx.handle.db, bot, new Date(), 50);
    expect(new Set(bot.sent.map((m) => m.chatId)).size).toBe(12);
    expect(bot.sent).toHaveLength(12);
  });
});

describe('Telegram Bot API client', () => {
  let server: ReturnType<typeof createServer>;
  let base = '';
  let seen: { url: string; body: string }[] = [];
  let respond: (res: import('node:http').ServerResponse) => void = (res) => res.end('{"ok":true}');

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ url: req.url ?? '', body });
        respond(res);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());
  afterEach(() => {
    seen = [];
    respond = (res) => res.end('{"ok":true}');
  });

  it('posts plain text to sendMessage', async () => {
    await createTelegramClient({ token: 'TOKEN123', baseUrl: base }).sendMessage(
      '42',
      'hello <b>x</b>',
    );
    expect(seen[0]?.url).toBe('/botTOKEN123/sendMessage');
    expect(JSON.parse(seen[0]?.body ?? '{}')).toEqual({
      chat_id: '42',
      text: 'hello <b>x</b>',
      disable_web_page_preview: true,
    });
  });

  it('reports API errors (permanent and rate limit) without leaking the token', async () => {
    respond = (res) => {
      res.statusCode = 403;
      res.end('{"ok":false,"description":"Forbidden: bot was blocked by the user"}');
    };
    const client = createTelegramClient({ token: 'SECRETTOKEN', baseUrl: base });
    const blocked = await client.sendMessage('1', 'x').catch((e: TelegramApiError) => e);
    expect(blocked).toBeInstanceOf(TelegramApiError);
    expect((blocked as TelegramApiError).isPermanent).toBe(true);

    respond = (res) => {
      res.statusCode = 429;
      res.end('{"ok":false,"description":"Too Many Requests","parameters":{"retry_after":9}}');
    };
    const limited = (await client
      .sendMessage('1', 'x')
      .catch((e: TelegramApiError) => e)) as TelegramApiError;
    expect(limited).toMatchObject({ status: 429, retryAfterSeconds: 9, isPermanent: false });
    expect(JSON.stringify([blocked, limited, String(blocked)])).not.toContain('SECRETTOKEN');
  });

  it('turns network failures and timeouts into retryable errors that omit the URL (and token)', async () => {
    const down = createTelegramClient({ token: 'SECRETTOKEN', baseUrl: 'http://127.0.0.1:1' });
    const error = (await down
      .sendMessage('1', 'x')
      .catch((e: TelegramApiError) => e)) as TelegramApiError;
    expect(error).toMatchObject({ status: 0, isPermanent: false });
    expect(`${error.message} ${error.description}`).not.toContain('SECRETTOKEN');

    respond = () => undefined; // never answer
    const slow = createTelegramClient({ token: 'SECRETTOKEN', baseUrl: base, timeoutMs: 50 });
    expect(await slow.sendMessage('1', 'x').catch((e: TelegramApiError) => e)).toMatchObject({
      status: 0,
    });
  });
});
