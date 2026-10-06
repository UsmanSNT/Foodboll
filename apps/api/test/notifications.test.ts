import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { enqueueNotification } from '../src/services/notifications';
import { bearer, createUser, startTestApp, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await startTestApp();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.reset());

const rowsFor = async (userId: string) =>
  (
    await ctx.handle.pool.query(
      'select type, channel, language_code, title, body, status from notifications where user_id = $1 order by channel',
      [userId],
    )
  ).rows as {
    type: string;
    channel: string;
    language_code: string;
    title: string;
    body: string;
    status: string;
  }[];
const get = (url: string, token: string, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: 'GET', url, headers: { ...bearer(token), ...headers } });
const post = (url: string, token: string, payload: object) =>
  ctx.app.inject({ method: 'POST', url, headers: bearer(token), payload });

describe('notification localization', () => {
  it('renders in Korean for Korean users', async () => {
    const user = await createUser(ctx, { preferredLanguage: 'ko' });
    await enqueueNotification(ctx.handle.db, { userId: user.id, type: 'PAYMENT_CONFIRMED' });
    expect(await rowsFor(user.id)).toEqual([
      {
        type: 'PAYMENT_CONFIRMED',
        channel: 'IN_APP',
        language_code: 'ko',
        title: '입금 확인 완료',
        body: '입금이 확인되었습니다.',
        status: 'SENT',
      },
    ]);
  });

  it('renders in Uzbek for Uzbek users', async () => {
    const user = await createUser(ctx, { preferredLanguage: 'uz' });
    await enqueueNotification(ctx.handle.db, { userId: user.id, type: 'PARTICIPATION_CONFIRMED' });
    expect((await rowsFor(user.id))[0]).toMatchObject({
      language_code: 'uz',
      body: 'Matchdagi ishtirokingiz tasdiqlandi.',
    });
  });

  it('uses the device language when the user never chose, else Korean', async () => {
    const uzDevice = await createUser(ctx, { deviceLocale: 'uz-UZ' });
    const unknown = await createUser(ctx, { deviceLocale: 'en-US' });
    const nothing = await createUser(ctx);
    for (const u of [uzDevice, unknown, nothing]) {
      await enqueueNotification(ctx.handle.db, { userId: u.id, type: 'PAYMENT_CONFIRMED' });
    }
    expect((await rowsFor(uzDevice.id))[0]?.language_code).toBe('uz');
    expect((await rowsFor(unknown.id))[0]?.language_code).toBe('ko');
    expect((await rowsFor(nothing.id))[0]?.language_code).toBe('ko');
  });

  it('an explicit choice beats the device language', async () => {
    const user = await createUser(ctx, { preferredLanguage: 'ko', deviceLocale: 'uz-UZ' });
    await enqueueNotification(ctx.handle.db, { userId: user.id, type: 'PAYMENT_CONFIRMED' });
    expect((await rowsFor(user.id))[0]?.language_code).toBe('ko');
  });

  it('rejects unknown users', async () => {
    await expect(
      enqueueNotification(ctx.handle.db, {
        userId: '00000000-0000-4000-8000-000000000000',
        type: 'PAYMENT_CONFIRMED',
      }),
    ).rejects.toThrow();
  });
});

describe('channels', () => {
  it('adds a Telegram delivery only for users who pressed Start in the bot', async () => {
    const started = await createUser(ctx, { telegramId: '111', telegramStarted: true });
    const notStarted = await createUser(ctx, { telegramId: '222' });
    for (const u of [started, notStarted]) {
      await enqueueNotification(ctx.handle.db, { userId: u.id, type: 'PAYMENT_CONFIRMED' });
    }
    expect((await rowsFor(started.id)).map((r) => [r.channel, r.status])).toEqual([
      ['IN_APP', 'SENT'],
      ['TELEGRAM', 'PENDING'],
    ]);
    expect((await rowsFor(notStarted.id)).map((r) => r.channel)).toEqual(['IN_APP']);
  });
});

describe('in-app inbox', () => {
  it('lists newest first with an unread count, in the language the user uses now', async () => {
    const user = await createUser(ctx, { preferredLanguage: 'ko' });
    await enqueueNotification(ctx.handle.db, {
      userId: user.id,
      type: 'PAYMENT_REJECTED',
      localizedParams: { reason: 'payment.rejectReason.AMOUNT_MISMATCH' },
    });
    await enqueueNotification(ctx.handle.db, { userId: user.id, type: 'PAYMENT_CONFIRMED' });

    const ko = (await get('/v1/me/notifications', user.token)).json();
    expect(ko.unread).toBe(2);
    expect(ko.items.map((i: { type: string }) => i.type)).toEqual([
      'PAYMENT_CONFIRMED',
      'PAYMENT_REJECTED',
    ]);
    expect(ko.items[1].body).toBe(
      '입금을 확인하지 못했습니다. 사유: 입금 금액이 일치하지 않습니다. 영수증을 다시 업로드해주세요.',
    );

    // The user switches language: old notifications read in the new language, reason included.
    const uz = (await get('/v1/me/notifications?lang=uz', user.token)).json();
    expect(uz.items[1]).toMatchObject({
      title: 'To‘lov tasdiqlanmadi',
      body: 'To‘lovni tasdiqlab bo‘lmadi. Sabab: To‘lov summasi mos kelmadi. Chekni qayta yuklang.',
    });
  });

  it('marks some or all as read, only for the owner', async () => {
    const user = await createUser(ctx);
    const other = await createUser(ctx);
    const [first, second] = [
      (await enqueueNotification(ctx.handle.db, { userId: user.id, type: 'PAYMENT_CONFIRMED' }))[0],
      (
        await enqueueNotification(ctx.handle.db, {
          userId: user.id,
          type: 'PARTICIPATION_CONFIRMED',
        })
      )[0],
    ];
    await enqueueNotification(ctx.handle.db, { userId: other.id, type: 'PAYMENT_CONFIRMED' });

    // Someone else cannot mark my notification read.
    await post('/v1/me/notifications/read', other.token, { ids: [first] });
    expect((await get('/v1/me/notifications', user.token)).json().unread).toBe(2);

    await post('/v1/me/notifications/read', user.token, { ids: [first] });
    const after = (await get('/v1/me/notifications', user.token)).json();
    expect(after.unread).toBe(1);
    expect(after.items.find((i: { id: string }) => i.id === first).readAt).not.toBeNull();

    await post('/v1/me/notifications/read', user.token, { all: true });
    expect((await get('/v1/me/notifications', user.token)).json().unread).toBe(0);
    expect((await get('/v1/me/notifications', other.token)).json().unread).toBe(1);
    void second;
  });

  it('validates the request and requires sign-in', async () => {
    const user = await createUser(ctx);
    expect((await post('/v1/me/notifications/read', user.token, {})).statusCode).toBe(400);
    expect(
      (await post('/v1/me/notifications/read', user.token, { ids: ['nope'] })).statusCode,
    ).toBe(400);
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/me/notifications' })).statusCode).toBe(
      401,
    );
  });

  it('only shows in-app entries (not Telegram deliveries)', async () => {
    const user = await createUser(ctx, { telegramId: '5', telegramStarted: true });
    await enqueueNotification(ctx.handle.db, { userId: user.id, type: 'PAYMENT_CONFIRMED' });
    expect((await get('/v1/me/notifications', user.token)).json().items).toHaveLength(1);
  });
});
