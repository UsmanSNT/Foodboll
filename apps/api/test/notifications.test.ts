import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { enqueueNotification } from '../src/services/notifications';
import { createUser, startTestApp, type TestContext } from './helpers';

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
  ).rows;

describe('notification localization', () => {
  it('renders in Korean for Korean users', async () => {
    const user = await createUser(ctx, { preferredLanguage: 'ko' });
    await enqueueNotification(ctx.handle.db, {
      userId: user.id,
      type: 'PAYMENT_CONFIRMED',
      channels: ['PUSH'],
    });
    expect(await rowsFor(user.id)).toEqual([
      {
        type: 'PAYMENT_CONFIRMED',
        channel: 'PUSH',
        language_code: 'ko',
        title: '입금 확인 완료',
        body: '입금이 확인되었습니다.',
        status: 'PENDING',
      },
    ]);
  });

  it('renders in Uzbek for Uzbek users, once per channel', async () => {
    const user = await createUser(ctx, { preferredLanguage: 'uz' });
    const ids = await enqueueNotification(ctx.handle.db, {
      userId: user.id,
      type: 'PARTICIPATION_CONFIRMED',
      channels: ['PUSH', 'EMAIL', 'SMS'],
    });
    expect(ids).toHaveLength(3);
    const rows = await rowsFor(user.id);
    expect(rows.map((r) => r.channel)).toEqual(['EMAIL', 'PUSH', 'SMS']);
    for (const row of rows) {
      expect(row.language_code).toBe('uz');
      expect(row.body).toBe('Matchdagi ishtirokingiz tasdiqlandi.');
    }
  });

  it('uses the device language when the user never chose, else Korean', async () => {
    const uzDevice = await createUser(ctx, { deviceLocale: 'uz-UZ' });
    const unknown = await createUser(ctx, { deviceLocale: 'en-US' });
    const nothing = await createUser(ctx);
    for (const u of [uzDevice, unknown, nothing]) {
      await enqueueNotification(ctx.handle.db, { userId: u.id, type: 'PAYMENT_CONFIRMED', channels: ['PUSH'] });
    }
    expect((await rowsFor(uzDevice.id))[0]?.language_code).toBe('uz');
    expect((await rowsFor(unknown.id))[0]?.language_code).toBe('ko');
    expect((await rowsFor(nothing.id))[0]?.language_code).toBe('ko');
  });

  it('an explicit choice beats the device language', async () => {
    const user = await createUser(ctx, { preferredLanguage: 'ko', deviceLocale: 'uz-UZ' });
    await enqueueNotification(ctx.handle.db, { userId: user.id, type: 'PAYMENT_CONFIRMED', channels: ['PUSH'] });
    expect((await rowsFor(user.id))[0]?.language_code).toBe('ko');
  });

  it('does nothing without channels and rejects unknown users', async () => {
    const user = await createUser(ctx);
    expect(await enqueueNotification(ctx.handle.db, { userId: user.id, type: 'PAYMENT_CONFIRMED', channels: [] })).toEqual([]);
    await expect(
      enqueueNotification(ctx.handle.db, {
        userId: '00000000-0000-4000-8000-000000000000',
        type: 'PAYMENT_CONFIRMED',
        channels: ['PUSH'],
      }),
    ).rejects.toThrow();
  });
});
