import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ingestBankMessage } from '../src/services/bank-deposits';
import {
  bearer,
  createUser,
  insertMatch,
  startTestApp,
  TEST_BANK_CHAT_ID,
  TEST_BANK_SECRET,
  TEST_WEBHOOK_SECRET,
  type TestContext,
} from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await startTestApp();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.reset());

const KST = 9 * 3600 * 1000;
/** A bank alert as it would look "now" in Korea. */
function sms(opts: { amount?: string; who?: string; at?: Date; memo?: string } = {}): string {
  const at = new Date((opts.at ?? new Date()).getTime() + KST);
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${p(at.getUTCMonth() + 1)}/${p(at.getUTCDate())} ${p(at.getUTCHours())}:${p(at.getUTCMinutes())}`;
  return `[KB]${stamp} 123456**789 ${opts.who ?? '홍길동'}${opts.memo ?? ''} 입금 ${opts.amount ?? '10,000'} 잔액 1,234,567`;
}

const post = (payload: object, secret: string | null = TEST_BANK_SECRET, app = ctx) =>
  app.app.inject({
    method: 'POST',
    url: '/v1/integrations/bank-notifications',
    headers: secret === null ? {} : { authorization: `Bearer ${secret}` },
    payload,
  });
const hours = (n: number) => n * 3600 * 1000;

async function paying(opts: { depositorName?: string; lang?: 'ko' | 'uz' } = {}) {
  const organizer = await createUser(ctx, { role: 'ORGANIZER' });
  const matchId = await insertMatch(ctx, organizer.id);
  return payer(matchId, opts);
}
async function payer(matchId: string, opts: { depositorName?: string; lang?: 'ko' | 'uz' } = {}) {
  const player = await createUser(ctx, { preferredLanguage: opts.lang ?? 'uz' });
  if (opts.depositorName) {
    await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/me/depositor-name',
      headers: bearer(player.token),
      payload: { depositorName: opts.depositorName },
    });
  }
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/v1/matches/${matchId}/registrations`,
    headers: bearer(player.token),
  });
  const reg = res.json() as { id: string; payment: { referenceCode: string } };
  return { player, matchId, registrationId: reg.id, code: reg.payment.referenceCode };
}
const state = async (registrationId: string) =>
  (
    await ctx.handle.pool.query(
      `select r.status as reg, p.status as pay, p.reference_code from match_registrations r join registration_payments p on p.registration_id = r.id where r.id = $1`,
      [registrationId],
    )
  ).rows[0] as { reg: string; pay: string; reference_code: string | null };
const deposits = async () =>
  (
    await ctx.handle.pool.query(
      'select status, match_method, reason, amount_krw, matched_registration_id from bank_deposits order by created_at',
    )
  ).rows as {
    status: string;
    match_method: string | null;
    reason: string | null;
    amount_krw: number | null;
    matched_registration_id: string | null;
  }[];

describe('reference codes', () => {
  it('are 4 digits, shown to the player, never a year, and unique across concurrent applications', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const matchIds = await Promise.all(
      Array.from({ length: 6 }, () => insertMatch(ctx, organizer.id)),
    );
    const results = await Promise.all(
      Array.from({ length: 36 }, async (_, i) => payer(matchIds[i % matchIds.length] ?? '')),
    );
    const codes = results.map((r) => r.code);
    expect(codes.every((c) => /^\d{4}$/.test(c))).toBe(true);
    expect(codes.every((c) => Number(c) < 1900 || Number(c) > 2100)).toBe(true);
    expect(new Set(codes).size).toBe(36);
  });

  it('are released when the seat is given up and can be reused', async () => {
    const { player, registrationId, code } = await paying();
    await ctx.app.inject({
      method: 'POST',
      url: `/v1/registrations/${registrationId}/cancel`,
      headers: bearer(player.token),
    });
    expect((await state(registrationId)).reference_code).toBeNull();
    const view = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me/registrations',
      headers: bearer(player.token),
    });
    expect(view.json().items[0].payment.referenceCode).toBeNull();
    void code;
  });

  it('is part of the registration the player sees while a payment is expected', async () => {
    const { player, code } = await paying();
    const view = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me/registrations',
      headers: bearer(player.token),
    });
    expect(view.json().items[0].payment.referenceCode).toBe(code);
  });
});

describe('automatic confirmation', () => {
  it('confirms a payment whose reference code is in the transfer memo, and tells the player', async () => {
    const { player, registrationId, code } = await paying({ lang: 'uz' });
    const res = await post({ text: sms({ who: 'KARIMOV', memo: code }), messageId: 'm-1' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'MATCHED', duplicate: false });

    expect(await state(registrationId)).toMatchObject({
      reg: 'CONFIRMED',
      pay: 'PAYMENT_CONFIRMED',
    });
    expect(await deposits()).toEqual([
      {
        status: 'MATCHED',
        match_method: 'REFERENCE',
        reason: null,
        amount_krw: 10_000,
        matched_registration_id: registrationId,
      },
    ]);
    const inbox = (
      await ctx.app.inject({
        method: 'GET',
        url: '/v1/me/notifications',
        headers: bearer(player.token),
      })
    ).json();
    expect(inbox.items.map((i: { body: string }) => i.body).sort()).toEqual([
      'Matchdagi ishtirokingiz tasdiqlandi.',
      'To‘lovingiz tasdiqlandi.',
    ]);
    const events = (
      await ctx.handle.pool.query(
        `select event, actor_id, detail from payment_events where registration_id = $1 order by created_at, id`,
        [registrationId],
      )
    ).rows;
    expect(events.map((e: { event: string }) => e.event)).toEqual([
      'PAYMENT_CREATED',
      'CONFIRMED',
      'DEPOSIT_MATCHED',
    ]);
    expect(events[1]).toMatchObject({
      actor_id: null,
      detail: { via: 'BANK_DEPOSIT', method: 'REFERENCE' },
    });
  });

  it('falls back to the depositor name when no memo was typed', async () => {
    const { registrationId } = await paying({ depositorName: 'Karimov Aziz' });
    const res = await post({ text: sms({ who: 'KARIMOV AZIZ' }) });
    expect(res.json().status).toBe('MATCHED');
    expect((await deposits())[0]?.match_method).toBe('NAME');
    expect((await state(registrationId)).pay).toBe('PAYMENT_CONFIRMED');
  });

  it('never guesses between two people with the same name; an admin assigns it', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const matchId = await insertMatch(ctx, organizer.id);
    const a = await payer(matchId, { depositorName: 'Kim Min Jun' });
    const b = await payer(matchId, { depositorName: 'KIM MIN JUN' });
    const res = await post({ text: sms({ who: 'KIM MINJUN' }) });
    expect(res.json().status).toBe('AMBIGUOUS');
    expect((await state(a.registrationId)).pay).toBe('AWAITING_PAYMENT');
    expect((await state(b.registrationId)).pay).toBe('AWAITING_PAYMENT');

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/bank-deposits?status=AMBIGUOUS',
      headers: bearer(admin.token),
    });
    const [item] = list.json().items;
    expect(item).toMatchObject({ reason: 'MULTIPLE_CANDIDATES', amountKrw: 10_000 });
    const assigned = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/bank-deposits/${item.id}/assign`,
      headers: bearer(admin.token),
      payload: { registrationId: b.registrationId },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json()).toMatchObject({ status: 'MATCHED', matchMethod: 'MANUAL' });
    expect((await state(b.registrationId)).pay).toBe('PAYMENT_CONFIRMED');
    expect((await state(a.registrationId)).pay).toBe('AWAITING_PAYMENT');
    // Resolved deposits cannot be assigned again.
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: `/v1/admin/bank-deposits/${item.id}/assign`,
          headers: bearer(admin.token),
          payload: { registrationId: a.registrationId },
        })
      ).statusCode,
    ).toBe(409);
  });

  it('leaves a wrong amount to a human', async () => {
    const { registrationId, code } = await paying();
    const res = await post({ text: sms({ amount: '5,000', memo: code }) });
    expect(res.json().status).toBe('UNMATCHED');
    expect((await deposits())[0]).toMatchObject({
      reason: 'AMOUNT_MISMATCH',
      amount_krw: 5_000,
      matched_registration_id: null,
    });
    expect((await state(registrationId)).pay).toBe('AWAITING_PAYMENT');
  });

  it('leaves unrelated deposits alone', async () => {
    const { registrationId } = await paying();
    await post({ text: sms({ who: '박지성' }) });
    expect((await deposits())[0]).toMatchObject({ status: 'UNMATCHED', reason: 'NO_CANDIDATE' });
    expect((await state(registrationId)).pay).toBe('AWAITING_PAYMENT');
  });

  it('does not confirm twice: a second deposit finds nothing left to pay', async () => {
    const { registrationId, code } = await paying();
    await post({ text: sms({ memo: code }), messageId: 'a' });
    await post({ text: sms({ memo: code }), messageId: 'b' });
    expect((await deposits()).map((d) => d.status)).toEqual(['MATCHED', 'UNMATCHED']);
    const confirmed = await ctx.handle.pool.query(
      `select count(*)::int as n from payment_events where registration_id = $1 and event = 'CONFIRMED'`,
      [registrationId],
    );
    expect(confirmed.rows[0].n).toBe(1);
  });

  it('does not touch payments that an admin already confirmed from a receipt', async () => {
    const { registrationId, code } = await paying();
    await ctx.handle.pool.query(
      `update registration_payments set status = 'PAYMENT_CONFIRMED' where registration_id = $1`,
      [registrationId],
    );
    await ctx.handle.pool.query(
      `update match_registrations set status = 'CONFIRMED' where id = $1`,
      [registrationId],
    );
    await post({ text: sms({ memo: code }) });
    expect((await deposits())[0]).toMatchObject({ status: 'UNMATCHED', reason: 'NO_CANDIDATE' });
  });

  it('ignores payments whose window lapsed or whose registration was cancelled', async () => {
    const lapsed = await paying();
    const cancelled = await paying();
    await ctx.handle.pool.query(
      `update registration_payments set due_at = now() - interval '1 minute' where registration_id = $1`,
      [lapsed.registrationId],
    );
    await ctx.app.inject({
      method: 'POST',
      url: `/v1/registrations/${cancelled.registrationId}/cancel`,
      headers: bearer(cancelled.player.token),
    });
    await post({ text: sms({ memo: lapsed.code }), messageId: '1' });
    await post({ text: sms({ memo: cancelled.code }), messageId: '2' });
    expect((await deposits()).map((d) => d.reason)).toEqual(['NO_CANDIDATE', 'NO_CANDIDATE']);
  });

  it('confirms a payment the admin rejected earlier once the money really arrives', async () => {
    const { registrationId, code } = await paying();
    await ctx.handle.pool.query(
      `update registration_payments set status = 'PAYMENT_REJECTED' where registration_id = $1`,
      [registrationId],
    );
    await post({ text: sms({ memo: code }) });
    expect((await state(registrationId)).pay).toBe('PAYMENT_CONFIRMED');
  });

  it('is idempotent: the same message delivered many times, even concurrently, confirms once', async () => {
    const { player, registrationId, code } = await paying();
    const text = sms({ memo: code });
    const results = await Promise.all(Array.from({ length: 6 }, () => post({ text })));
    expect(results.map((r) => r.statusCode)).toEqual(Array(6).fill(200));
    expect(results.filter((r) => !r.json().duplicate)).toHaveLength(1);
    expect(await deposits()).toHaveLength(1);
    const inbox = (
      await ctx.app.inject({
        method: 'GET',
        url: '/v1/me/notifications',
        headers: bearer(player.token),
      })
    ).json();
    expect(inbox.items).toHaveLength(2);
    expect((await state(registrationId)).pay).toBe('PAYMENT_CONFIRMED');
  });
});

describe('messages that must not be trusted', () => {
  it('drops text that is not about a deposit without storing it', async () => {
    const res = await post({ text: '택배가 도착했습니다. 문 앞에 두었습니다.' });
    expect(res.json()).toEqual({ status: 'DROPPED', duplicate: false });
    expect(await deposits()).toEqual([]);
  });

  it('keeps unparsable deposit-like messages for a human, without confirming anything', async () => {
    const { registrationId, code } = await paying();
    await post({ text: `[KB] 출금 10,000원 입금계좌 123-456 ${code}` });
    expect((await deposits())[0]).toMatchObject({ status: 'IGNORED', reason: 'NOT_PARSED' });
    expect((await state(registrationId)).pay).toBe('AWAITING_PAYMENT');
  });

  it('refuses stale messages (replayed or re-forwarded old SMS)', async () => {
    const { registrationId, code } = await paying();
    // Printed time three days ago, received now.
    await post({
      text: sms({ memo: code, at: new Date(Date.now() - hours(72)) }),
      messageId: 'old-print',
    });
    // Printed now, but the phone says it received it three days ago.
    await post({
      text: sms({ memo: code }),
      receivedAt: new Date(Date.now() - hours(72)).toISOString(),
      messageId: 'old-recv',
    });
    // From the future.
    await post({
      text: sms({ memo: code, at: new Date(Date.now() + hours(5)) }),
      receivedAt: new Date(Date.now() + hours(5)).toISOString(),
      messageId: 'future',
    });
    expect((await deposits()).map((d) => d.reason)).toEqual([
      'STALE_MESSAGE',
      'STALE_MESSAGE',
      'STALE_MESSAGE',
    ]);
    expect((await state(registrationId)).pay).toBe('AWAITING_PAYMENT');
  });

  it('infers the year across New Year (a 12/31 message received on 1/1)', async () => {
    const { registrationId, code } = await paying();
    const bank = ctx.config.bank;
    const received = new Date('2027-01-01T00:05:00+09:00');
    const text = `[KB]12/31 23:58 123456**789 홍길동 입금 10,000 잔액 1,234,567 ${code}`;
    const res = await ingestBankMessage(
      ctx.handle.db,
      bank,
      { source: 'WEBHOOK', text, receivedAt: received },
      received,
    );
    // The payment window is relative to real time, so this only proves the message was not stale.
    expect(res.reason).not.toBe('STALE_MESSAGE');
    void registrationId;
  });

  it('stops confirming automatically when too many arrive at once, and asks for review', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const matchId = await insertMatch(ctx, organizer.id);
    const limited = { ...ctx.config.bank, autoConfirmLimitPer10Min: 2 };
    const people = [await payer(matchId), await payer(matchId), await payer(matchId)];
    const outcomes: string[] = [];
    for (const [i, p] of people.entries()) {
      const r = await ingestBankMessage(ctx.handle.db, limited, {
        source: 'WEBHOOK',
        text: sms({ memo: p.code }),
        receivedAt: new Date(),
        externalId: `g${i}`,
      });
      outcomes.push(r.status);
    }
    expect(outcomes).toEqual(['MATCHED', 'MATCHED', 'AMBIGUOUS']);
    expect((await deposits())[2]?.reason).toBe('RATE_GUARD');
    expect((await state(people[2]?.registrationId ?? '')).pay).toBe('AWAITING_PAYMENT');
  });

  it('a reference code appearing inside a longer number does not match', async () => {
    const { registrationId, code } = await paying();
    await post({ text: sms({ who: `홍길동 91${code}7` }) });
    expect((await state(registrationId)).pay).toBe('AWAITING_PAYMENT');
  });
});

describe('webhook security', () => {
  it('requires the shared secret, compared in constant time', async () => {
    expect((await post({ text: sms() }, null)).statusCode).toBe(401);
    expect(
      (await post({ text: sms() }, 'wrong-secret-wrong-secret-wrong-secret-xx')).statusCode,
    ).toBe(401);
    expect((await post({ text: sms() }, TEST_BANK_SECRET.slice(0, -1))).statusCode).toBe(401);
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/v1/integrations/bank-notifications',
          headers: { authorization: `Basic ${TEST_BANK_SECRET}` },
          payload: { text: sms() },
        })
      ).statusCode,
    ).toBe(401);
    expect(await deposits()).toEqual([]);
  });

  it('does not exist when no secret is configured', async () => {
    const off = await startTestApp({ bank: { ...ctx.config.bank, webhookSecret: null } });
    try {
      expect((await post({ text: sms() }, TEST_BANK_SECRET, off)).statusCode).toBe(404);
    } finally {
      await off.close();
    }
  });

  it('validates the payload and bounds its size', async () => {
    expect((await post({})).statusCode).toBe(400);
    expect((await post({ text: sms(), extra: 1 })).statusCode).toBe(400);
    expect((await post({ text: 'x'.repeat(3000) })).statusCode).toBe(400);
    const huge = await post({ text: '입금 '.repeat(20_000) });
    expect(huge.statusCode).toBe(413);
    expect(huge.json().error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('drops messages from senders that are not the bank when an allow-list is set', async () => {
    const strict = await startTestApp({
      bank: { ...ctx.config.bank, allowedSenders: ['KB Bank'] },
    });
    try {
      const spoof = await post(
        { text: sms({ memo: '1234' }), sender: '+821099998888' },
        TEST_BANK_SECRET,
        strict,
      );
      expect(spoof.json().status).toBe('DROPPED');
      const none = await post({ text: sms({ memo: '1234' }) }, TEST_BANK_SECRET, strict);
      expect(none.json().status).toBe('DROPPED');
      const ok = await post(
        { text: sms({ memo: '1234' }), sender: 'KB Bank' },
        TEST_BANK_SECRET,
        strict,
      );
      expect(ok.json().status).toBe('UNMATCHED');
    } finally {
      await strict.close();
    }
  });

  it('never echoes the message text back', async () => {
    const res = await post({ text: sms({ who: 'SECRET-NAME-홍길동' }) });
    expect(res.body).not.toContain('SECRET-NAME');
  });
});

describe('Telegram bank channel', () => {
  const update = (post: Record<string, unknown>, key = 'channel_post') => ({
    update_id: 1,
    [key]: post,
  });
  const hook = (body: object) =>
    ctx.app.inject({
      method: 'POST',
      url: '/v1/integrations/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': TEST_WEBHOOK_SECRET },
      payload: body,
    });

  it('ingests posts from the configured channel', async () => {
    const tg = await startTestApp({}, { telegram: { sendMessage: async () => undefined } });
    try {
      const { registrationId, code } = await (async () => {
        const organizer = await createUser(tg, { role: 'ORGANIZER' });
        const matchId = await insertMatch(tg, organizer.id);
        const player = await createUser(tg);
        const r = (
          await tg.app.inject({
            method: 'POST',
            url: `/v1/matches/${matchId}/registrations`,
            headers: bearer(player.token),
          })
        ).json();
        return { registrationId: r.id as string, code: r.payment.referenceCode as string };
      })();
      const res = await tg.app.inject({
        method: 'POST',
        url: '/v1/integrations/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': TEST_WEBHOOK_SECRET },
        payload: update({
          message_id: 7,
          date: Math.floor(Date.now() / 1000),
          chat: { id: Number(TEST_BANK_CHAT_ID), type: 'channel' },
          text: sms({ memo: code }),
        }),
      });
      expect(res.statusCode).toBe(200);
      const row = (
        await tg.handle.pool.query(
          `select p.status from registration_payments p where p.registration_id = $1`,
          [registrationId],
        )
      ).rows[0];
      expect(row.status).toBe('PAYMENT_CONFIRMED');
      expect((await tg.handle.pool.query(`select source from bank_deposits`)).rows).toEqual([
        { source: 'TELEGRAM' },
      ]);
    } finally {
      await tg.close();
    }
  });

  it('ignores other channels, groups, edited posts and private chats', async () => {
    const { code } = await paying();
    const text = sms({ memo: code });
    const date = Math.floor(Date.now() / 1000);
    await hook(update({ message_id: 1, date, chat: { id: -100999, type: 'channel' }, text })); // other channel
    await hook(
      update({
        message_id: 2,
        date,
        chat: { id: Number(TEST_BANK_CHAT_ID), type: 'supergroup' },
        text,
      }),
    ); // a group: anyone can write there
    await hook(
      update(
        { message_id: 3, date, chat: { id: Number(TEST_BANK_CHAT_ID), type: 'channel' }, text },
        'edited_channel_post',
      ),
    );
    await hook({
      message: { message_id: 4, date, from: { id: 5 }, chat: { id: 5, type: 'private' }, text },
    }); // a stranger DMs the bot
    expect(await deposits()).toEqual([]);
  });
});

describe('admin review of deposits', () => {
  it('lists by status (admins only), and refuses to assign a mismatching amount', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const { registrationId, player } = await paying();
    await post({ text: sms({ who: '누군가', amount: '20,000' }) });
    const list = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/bank-deposits',
      headers: bearer(admin.token),
    });
    expect(list.json().items).toHaveLength(1);
    expect(list.json().items[0].rawText).toContain('누군가');
    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: '/v1/admin/bank-deposits',
          headers: bearer(player.token),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: '/v1/admin/bank-deposits?status=NOPE',
          headers: bearer(admin.token),
        })
      ).statusCode,
    ).toBe(400);

    const id = list.json().items[0].id as string;
    const wrong = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/bank-deposits/${id}/assign`,
      headers: bearer(admin.token),
      payload: { registrationId },
    });
    expect(wrong.statusCode).toBe(409);
    expect((await state(registrationId)).pay).toBe('AWAITING_PAYMENT');

    const ignored = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/bank-deposits/${id}/ignore`,
      headers: bearer(admin.token),
    });
    expect(ignored.json()).toMatchObject({ status: 'IGNORED', reason: 'MANUAL' });
    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: '/v1/admin/bank-deposits?status=UNMATCHED',
          headers: bearer(admin.token),
        })
      ).json().items,
    ).toEqual([]);
  });
});

describe('depositor name', () => {
  it('is saved on the account, can be cleared, and is validated', async () => {
    const user = await createUser(ctx);
    const patch = (payload: object) =>
      ctx.app.inject({
        method: 'PATCH',
        url: '/v1/me/depositor-name',
        headers: bearer(user.token),
        payload,
      });
    expect((await patch({ depositorName: '  Karimov Aziz ' })).json().depositorName).toBe(
      'Karimov Aziz',
    );
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(user.token) })).json()
        .depositorName,
    ).toBe('Karimov Aziz');
    expect((await patch({ depositorName: null })).json().depositorName).toBeNull();
    expect((await patch({ depositorName: '   ' })).statusCode).toBe(400);
    expect((await patch({ depositorName: 'x'.repeat(61) })).statusCode).toBe(400);
    expect((await patch({ other: 1 })).statusCode).toBe(400);
  });
});
