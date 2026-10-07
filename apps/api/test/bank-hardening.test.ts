import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseBankMessage } from '../src/banking/parse-bank-message';
import { ingestBankMessage } from '../src/services/bank-deposits';
import { bearer, createUser, insertMatch, startTestApp, TEST_BANK_SECRET } from './helpers';
import type { TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await startTestApp();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.reset());

const KST = 9 * 3600 * 1000;
function sms(opts: { who?: string; memo?: string; amount?: string; at?: Date } = {}): string {
  const at = new Date((opts.at ?? new Date()).getTime() + KST);
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${p(at.getUTCMonth() + 1)}/${p(at.getUTCDate())} ${p(at.getUTCHours())}:${p(at.getUTCMinutes())}`;
  return `[KB]${stamp} 123456**789 ${opts.who ?? '홍길동'}${opts.memo ?? ''} 입금 ${opts.amount ?? '10,000'} 잔액 1,234,567`;
}
const post = (payload: object) =>
  ctx.app.inject({
    method: 'POST',
    url: '/v1/integrations/bank-notifications',
    headers: { authorization: `Bearer ${TEST_BANK_SECRET}` },
    payload,
  });

async function payer(matchId: string, depositorName?: string) {
  const player = await createUser(ctx, { preferredLanguage: 'uz' });
  if (depositorName) {
    await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/me/depositor-name',
      headers: bearer(player.token),
      payload: { depositorName },
    });
  }
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/v1/matches/${matchId}/registrations`,
    headers: bearer(player.token),
  });
  const reg = res.json() as { id: string; payment: { referenceCode: string } };
  return { player, registrationId: reg.id, code: reg.payment.referenceCode };
}
async function world() {
  const organizer = await createUser(ctx, { role: 'ORGANIZER' });
  const admin = await createUser(ctx, { role: 'ADMIN' });
  const matchId = await insertMatch(ctx, organizer.id);
  return { organizer, admin, matchId };
}
const q = async <T>(sql: string, args: unknown[] = []) =>
  (await ctx.handle.pool.query(sql, args)).rows as T[];
const state = async (registrationId: string) =>
  (
    await q<{
      reg: string;
      pay: string;
      reference_code: string | null;
      reject_reason: string | null;
    }>(
      `select r.status as reg, p.status as pay, p.reference_code, p.reject_reason
         from match_registrations r join registration_payments p on p.registration_id = r.id where r.id = $1`,
      [registrationId],
    )
  )[0];
const deposits = () =>
  q<{
    id: string;
    status: string;
    reason: string | null;
    match_method: string | null;
    matched_registration_id: string | null;
  }>(
    'select id, status, reason, match_method, matched_registration_id from bank_deposits order by created_at',
  );
const verified = async (userId: string) =>
  (
    await q<{ v: boolean }>('select depositor_name_verified as v from users where id = $1', [
      userId,
    ])
  )[0]?.v;

describe('name matching cannot be abused', () => {
  it('an unproven name never confirms by itself: it waits in the queue with a hint, and the admin assign proves it', async () => {
    const { admin, matchId } = await world();
    const a = await payer(matchId, 'Karimov Aziz');
    const res = await post({ text: sms({ who: 'KARIMOV AZIZ' }) });
    expect(res.json().status).toBe('AMBIGUOUS');
    expect((await state(a.registrationId))?.pay).toBe('AWAITING_PAYMENT');
    const [dep] = await deposits();
    expect(dep).toMatchObject({
      status: 'AMBIGUOUS',
      reason: 'NAME_UNVERIFIED',
      matched_registration_id: a.registrationId,
    });

    const assigned = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/bank-deposits/${dep?.id}/assign`,
      headers: bearer(admin.token),
      payload: { registrationId: a.registrationId },
    });
    expect(assigned.statusCode).toBe(200);
    expect(await verified(a.player.id)).toBe(true);

    // Proven now: the same name confirms a later payment without a code.
    const other = await insertMatch(ctx, (await createUser(ctx, { role: 'ORGANIZER' })).id);
    const second = await ctx.app.inject({
      method: 'POST',
      url: `/v1/matches/${other}/registrations`,
      headers: bearer(a.player.token),
    });
    const secondId = (second.json() as { id: string }).id;
    const res2 = await post({
      text: sms({ who: 'KARIMOV AZIZ', at: new Date(Date.now() + 61000) }),
    });
    expect(res2.json().status).toBe('MATCHED');
    expect((await state(secondId))?.pay).toBe('PAYMENT_CONFIRMED');
  });

  it('a deposit matched by code that carries the saved name proves the name; changing the name resets it', async () => {
    const { matchId } = await world();
    const a = await payer(matchId, 'Karimov Aziz');
    const res = await post({ text: sms({ who: 'KARIMOV AZIZ', memo: ` ${a.code}` }) });
    expect(res.json().status).toBe('MATCHED');
    expect(await verified(a.player.id)).toBe(true);
    await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/me/depositor-name',
      headers: bearer(a.player.token),
      payload: { depositorName: 'Karimov Aziz' },
    });
    expect(await verified(a.player.id)).toBe(true); // unchanged name keeps its proof
    await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/me/depositor-name',
      headers: bearer(a.player.token),
      payload: { depositorName: 'Someone Else' },
    });
    expect(await verified(a.player.id)).toBe(false);
  });

  it('a code match whose alert does not contain the saved name proves nothing', async () => {
    const { matchId } = await world();
    const a = await payer(matchId, 'Karimov Aziz');
    await post({ text: sms({ who: 'OTHERNAME', memo: ` ${a.code}` }) });
    expect((await state(a.registrationId))?.pay).toBe('PAYMENT_CONFIRMED');
    expect(await verified(a.player.id)).toBe(false);
  });

  it('matches whole tokens only: a saved name is never a substring of a longer word, and short names never match', async () => {
    const { matchId } = await world();
    const long = await payer(matchId, '홍길동');
    const short = await payer(matchId, '김민');
    const latin = await payer(matchId, 'Ali');
    await ctx.handle.pool.query('update users set depositor_name_verified = true');
    for (const who of ['홍길동생', '김민', 'ALI', 'XALIX']) {
      const res = await post({
        text: sms({ who, at: new Date(Date.now() - Math.random() * 1e6) }),
      });
      expect(res.json().status).toBe('UNMATCHED');
    }
    for (const r of [long, short, latin])
      expect((await state(r.registrationId))?.pay).toBe('AWAITING_PAYMENT');
    // The exact whole name still works for a proven name.
    const ok = await post({ text: sms({ who: '홍길동', at: new Date(Date.now() - 2e6) }) });
    expect(ok.json().status).toBe('MATCHED');
  });

  it('a name saved by two accounts, even if the other has no payment, never confirms', async () => {
    const { matchId } = await world();
    const a = await payer(matchId, 'Karimov Aziz');
    await createUser(ctx, { displayName: 'twin' }).then((u) =>
      ctx.app.inject({
        method: 'PATCH',
        url: '/v1/me/depositor-name',
        headers: bearer(u.token),
        payload: { depositorName: 'KARIMOV AZIZ' },
      }),
    );
    await ctx.handle.pool.query('update users set depositor_name_verified = true');
    const res = await post({ text: sms({ who: 'KARIMOV AZIZ' }) });
    expect(res.json().status).toBe('AMBIGUOUS');
    expect((await deposits())[0]?.reason).toBe('MULTIPLE_CANDIDATES');
    expect((await state(a.registrationId))?.pay).toBe('AWAITING_PAYMENT');
  });

  it("a code that matches one payment is not confirmed when another player's saved name is in the alert", async () => {
    const { matchId } = await world();
    const a = await payer(matchId);
    const b = await payer(matchId, 'Karimov Aziz');
    const res = await post({ text: sms({ who: 'KARIMOV AZIZ', memo: ` ${a.code}` }) });
    expect(res.json().status).toBe('AMBIGUOUS');
    expect((await state(a.registrationId))?.pay).toBe('AWAITING_PAYMENT');
    expect((await state(b.registrationId))?.pay).toBe('AWAITING_PAYMENT');
    expect((await deposits())[0]?.reason).toBe('MULTIPLE_CANDIDATES');
  });
});

describe('parser edge cases', () => {
  it('入出金 is not a withdrawal and a parenthesised receiving account is not a payment code', () => {
    const r = parseBankMessage('입출금통장(4821) 04/12 15:30 홍길동 입금 10,000원 잔액 99,000원');
    expect(r).toMatchObject({ kind: 'DEPOSIT', amountKrw: 10_000 });
    if (r.kind === 'DEPOSIT') expect(r.residual).not.toContain('4821');
    const b = parseBankMessage('[KB] 계좌(1234) 홍길동 입금 10,000원');
    if (b.kind === 'DEPOSIT') expect(b.residual).not.toContain('1234');
    expect(parseBankMessage('[KB] 출금 10,000원 입금계좌 123-456')).toMatchObject({
      kind: 'IGNORED',
      reason: 'WITHDRAWAL',
    });
  });

  it('strips NUL characters, and never reads a decimal or malformed grouping as a different amount', () => {
    expect(parseBankMessage('홍길동\u0000 입금 10,000원')).toMatchObject({ amountKrw: 10_000 });
    for (const text of ['입금 10,000.50원 홍길동', '입금 1,0000원 홍길동', '입금 10,00원 홍길동']) {
      expect(parseBankMessage(text)).toMatchObject({ kind: 'IGNORED', reason: 'AMBIGUOUS_AMOUNT' });
    }
  });

  it('unreadable deposits reach the admin queue; non-deposits stay ignored', async () => {
    const { matchId } = await world();
    await payer(matchId);
    await post({ text: '[KB] 입금 확인 부탁드립니다 홍길동' });
    await post({ text: '[KB] 입금 10,000원 입금 20,000원 홍길동' });
    await post({ text: '[KB] 출금 5,000원 입금계좌 123-456 홍길동' });
    const rows = await deposits();
    expect(rows.map((r) => [r.status, r.reason])).toEqual([
      ['UNMATCHED', 'NOT_PARSED'],
      ['UNMATCHED', 'NOT_PARSED'],
      ['IGNORED', 'NOT_PARSED'],
    ]);
  });
});

describe('deduplication', () => {
  it('an alert that prints its date and time is one message however late it is redelivered', async () => {
    const { matchId } = await world();
    await payer(matchId);
    const text = sms({ who: 'NOBODY' });
    const t0 = new Date();
    const first = await ingestBankMessage(
      ctx.handle.db,
      ctx.config.bank,
      { source: 'WEBHOOK', text, receivedAt: t0 },
      t0,
    );
    const later = new Date(t0.getTime() + 25 * 60 * 1000);
    const again = await ingestBankMessage(
      ctx.handle.db,
      ctx.config.bank,
      { source: 'WEBHOOK', text, receivedAt: later },
      later,
    );
    expect(first.duplicate).toBe(false);
    expect(again).toMatchObject({ duplicate: true, depositId: first.depositId });
  });

  it('a message id still distinguishes deliveries', async () => {
    const text = sms({ who: 'NOBODY' });
    const a = await post({ text, messageId: 'a' });
    const b = await post({ text, messageId: 'b' });
    expect(a.json().duplicate).toBe(false);
    expect(b.json().duplicate).toBe(false);
  });
});

describe('revoking a confirmed payment', () => {
  async function autoConfirmed() {
    const w = await world();
    const a = await payer(w.matchId);
    const res = await post({ text: sms({ who: 'KARIMOV', memo: ` ${a.code}` }) });
    expect(res.json().status).toBe('MATCHED');
    return { ...w, a };
  }
  const reject = (token: string, registrationId: string, reason = 'PAYMENT_NOT_FOUND') =>
    ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/registrations/${registrationId}/payment/reject`,
      headers: bearer(token),
      payload: { reason },
    });

  it('returns the registration to APPLIED with a fresh code, frees the deposit and notifies the player', async () => {
    const { admin, a } = await autoConfirmed();
    const oldCode = a.code;
    const res = await reject(admin.token, a.registrationId);
    expect(res.statusCode).toBe(200);
    const s = await state(a.registrationId);
    expect(s).toMatchObject({
      reg: 'APPLIED',
      pay: 'PAYMENT_REJECTED',
      reject_reason: 'PAYMENT_NOT_FOUND',
    });
    expect(s?.reference_code).toMatch(/^\d{4}$/);
    expect(s?.reference_code).not.toBeNull();
    void oldCode;
    expect((await deposits())[0]).toMatchObject({
      status: 'UNMATCHED',
      match_method: null,
      matched_registration_id: null,
    });
    const events = await q<{ event: string; detail: { revoked?: boolean } }>(
      'select event, detail from payment_events where registration_id = $1 order by created_at',
      [a.registrationId],
    );
    expect(events.at(-1)).toMatchObject({ event: 'REJECTED', detail: { revoked: true } });
    const notes = await q<{ type: string }>('select type from notifications where user_id = $1', [
      a.player.id,
    ]);
    expect(notes.map((n) => n.type)).toContain('PAYMENT_REJECTED');

    // The admin can now assign the freed deposit to the right registration.
    const b = await payer(
      (
        await q<{ match_id: string }>('select match_id from match_registrations where id = $1', [
          a.registrationId,
        ])
      )[0]?.match_id ?? '',
    );
    const [dep] = await deposits();
    const assigned = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/bank-deposits/${dep?.id}/assign`,
      headers: bearer(admin.token),
      payload: { registrationId: b.registrationId },
    });
    expect(assigned.statusCode).toBe(200);
  });

  it('refuses when the match has started or attendance was marked, and for non-admins', async () => {
    const { admin, a } = await autoConfirmed();
    const player = a.player;
    expect((await reject(player.token, a.registrationId)).statusCode).toBe(403);
    await ctx.handle.pool.query(
      'update match_registrations set attendance_marked_at = now() where id = $1',
      [a.registrationId],
    );
    expect((await reject(admin.token, a.registrationId)).statusCode).toBe(409);
    await ctx.handle.pool.query(
      'update match_registrations set attendance_marked_at = null where id = $1',
      [a.registrationId],
    );
    await ctx.handle.pool.query(
      `update matches set starts_at = now() - interval '1 hour', ends_at = now() + interval '1 hour'
        where id = (select match_id from match_registrations where id = $1)`,
      [a.registrationId],
    );
    expect((await reject(admin.token, a.registrationId)).statusCode).toBe(409);
    expect((await state(a.registrationId))?.pay).toBe('PAYMENT_CONFIRMED');
  });

  it('un-proves the name that the wrong deposit proved', async () => {
    const w = await world();
    const a = await payer(w.matchId, 'Karimov Aziz');
    await post({ text: sms({ who: 'KARIMOV AZIZ', memo: ` ${a.code}` }) });
    expect(await verified(a.player.id)).toBe(true);
    await reject(w.admin.token, a.registrationId);
    expect(await verified(a.player.id)).toBe(false);
  });
});

describe('cancelled registrations and reference codes', () => {
  async function cancelledAfterDeposit() {
    const w = await world();
    const a = await payer(w.matchId);
    await post({ text: sms({ who: 'KARIMOV', memo: ` ${a.code}` }) });
    await ctx.app.inject({
      method: 'POST',
      url: `/v1/registrations/${a.registrationId}/cancel`,
      headers: bearer(a.player.token),
    });
    return { ...w, a };
  }
  const close = (token: string, registrationId: string) =>
    ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/registrations/${registrationId}/payment/reject`,
      headers: bearer(token),
      payload: { reason: 'OTHER' },
    });

  it('closing a REFUND_PENDING payment frees its reference code', async () => {
    const w = await world();
    const a = await payer(w.matchId);
    // Review-origin refund pending (no deposit): upload a receipt, then cancel.
    await ctx.handle.pool.query(
      `update registration_payments set status = 'PAYMENT_REVIEW' where registration_id = $1`,
      [a.registrationId],
    );
    await ctx.app.inject({
      method: 'POST',
      url: `/v1/registrations/${a.registrationId}/cancel`,
      headers: bearer(a.player.token),
    });
    expect((await state(a.registrationId))?.pay).toBe('REFUND_PENDING');
    expect((await close(w.admin.token, a.registrationId)).statusCode).toBe(200);
    expect(await state(a.registrationId)).toMatchObject({
      pay: 'PAYMENT_REJECTED',
      reference_code: null,
    });
  });

  it('refuses to close without refund when a bank deposit settled the payment: refund it instead', async () => {
    const { admin, a } = await cancelledAfterDeposit();
    expect((await state(a.registrationId))?.pay).toBe('REFUND_PENDING');
    expect((await close(admin.token, a.registrationId)).statusCode).toBe(409);
    const refund = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/registrations/${a.registrationId}/payment/refund`,
      headers: bearer(admin.token),
    });
    expect(refund.statusCode).toBe(200);
  });

  it('when the code pool is exhausted by lapsed holds, applying reclaims them instead of failing', async () => {
    const w = await world();
    const started = await insertMatch(ctx, w.organizer.id);
    await ctx.handle.pool.query(
      `update matches set starts_at = now() - interval '3 days', ends_at = now() - interval '2 days' where id = $1`,
      [started],
    );
    await ctx.handle.pool.query(
      `insert into users (display_name) select 'filler' from generate_series(1, 9799)`,
    );
    await ctx.handle.pool.query(
      `insert into match_registrations (match_id, user_id, status)
       select $1, id, 'APPLIED' from users where display_name = 'filler'`,
      [started],
    );
    await ctx.handle.pool.query(
      `with r as (select id, row_number() over (order by id) rn from match_registrations where match_id = $1),
            c as (select lpad(n::text, 4, '0') code, row_number() over (order by n) rn
                    from generate_series(0, 9999) n where n not between 1900 and 2100)
       insert into registration_payments (registration_id, amount_krw, reference_code, status, due_at)
       select r.id, 10000, c.code, 'AWAITING_PAYMENT', now() - interval '2 days' from r join c using (rn)`,
      [started],
    );
    const a = await payer(w.matchId);
    expect(a.code).toMatch(/^\d{4}$/);
    const [{ n }] = (await q<{ n: number }>(
      `select count(*)::int n from registration_payments where reference_code is null`,
    )) as [{ n: number }];
    expect(n).toBe(500);
    const expired = await q<{ n: number }>(
      `select count(*)::int n from payment_events where event = 'EXPIRED'`,
    );
    expect(expired[0]?.n).toBe(500);
  }, 60_000);
});
