import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bearer,
  createUser,
  insertMatch,
  pngBytes,
  startTestApp,
  type TestContext,
} from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await startTestApp();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.reset());

const send = (
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  token: string | null,
  payload?: object,
) =>
  ctx.app.inject({
    method,
    url,
    headers: token ? bearer(token) : {},
    ...(payload && { payload }),
  });
const cancelMatch = (matchId: string, token: string | null, lang?: string) =>
  send('POST', `/v1/matches/${matchId}/cancel${lang ? `?lang=${lang}` : ''}`, token);
const apply = async (token: string, matchId: string) =>
  (await send('POST', `/v1/matches/${matchId}/registrations`, token)).json().id as string;
const upload = (token: string, registrationId: string) =>
  ctx.app.inject({
    method: 'PUT',
    url: `/v1/registrations/${registrationId}/receipt`,
    headers: { ...bearer(token), 'content-type': 'image/png' },
    payload: pngBytes(),
  });

const registrationRow = async (id: string) =>
  (
    await ctx.handle.pool.query(
      `select r.status, p.status as payment_status, p.reference_code, p.receipt_key
         from match_registrations r left join registration_payments p on p.registration_id = r.id
        where r.id = $1`,
      [id],
    )
  ).rows[0] as {
    status: string;
    payment_status: string | null;
    reference_code: string | null;
    receipt_key: string | null;
  };
const inbox = async (userId: string) =>
  (
    await ctx.handle.pool.query(
      `select type, language_code, title, body, channel from notifications
        where user_id = $1 order by created_at, channel`,
      [userId],
    )
  ).rows as { type: string; language_code: string; title: string; body: string; channel: string }[];
const events = async (registrationId: string) =>
  (
    await ctx.handle.pool.query(
      `select event, from_status, to_status, actor_id, detail from payment_events
        where registration_id = $1 order by created_at, id`,
      [registrationId],
    )
  ).rows as {
    event: string;
    from_status: string | null;
    to_status: string | null;
    actor_id: string | null;
    detail: Record<string, unknown>;
  }[];

/** A player who paid and was confirmed by an admin. */
async function confirmedPlayer(matchId: string, admin: { token: string }, options = {}) {
  const player = await createUser(ctx, options);
  const registrationId = await apply(player.token, matchId);
  expect((await upload(player.token, registrationId)).statusCode).toBe(200);
  const confirm = await send(
    'POST',
    `/v1/admin/registrations/${registrationId}/payment/confirm`,
    admin.token,
  );
  expect(confirm.statusCode).toBe(200);
  return { player, registrationId };
}

async function setup() {
  const organizer = await createUser(ctx, { role: 'ORGANIZER' });
  const admin = await createUser(ctx, { role: 'ADMIN' });
  const matchId = await insertMatch(ctx, organizer.id, { title: '서울 풋살장 5v5 매치' });
  return { organizer, admin, matchId };
}

describe('POST /v1/matches/:id/cancel: who may cancel', () => {
  it('lets the organizer who owns the match cancel it and returns the cancelled match', async () => {
    const { organizer, matchId } = await setup();
    const res = await cancelMatch(matchId, organizer.token);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: matchId, cancelledAt: expect.any(String) });
    const { rows } = await ctx.handle.pool.query(
      'select cancelled_at, cancelled_by from matches where id = $1',
      [matchId],
    );
    expect(rows[0].cancelled_by).toBe(organizer.id);
    expect(rows[0].cancelled_at).toBeInstanceOf(Date);
  });

  it('lets an admin cancel any match', async () => {
    const { admin, matchId } = await setup();
    const res = await cancelMatch(matchId, admin.token);
    expect(res.statusCode).toBe(200);
    expect(res.json().cancelledAt).not.toBeNull();
  });

  it('refuses another organizer, a player and anonymous callers, and changes nothing', async () => {
    const { matchId } = await setup();
    const other = await createUser(ctx, { role: 'ORGANIZER' });
    const player = await createUser(ctx);
    expect((await cancelMatch(matchId, other.token)).statusCode).toBe(403);
    expect((await cancelMatch(matchId, player.token)).statusCode).toBe(403);
    expect((await cancelMatch(matchId, null)).statusCode).toBe(401);
    const { rows } = await ctx.handle.pool.query('select cancelled_at from matches where id = $1', [
      matchId,
    ]);
    expect(rows[0].cancelled_at).toBeNull();
  });

  it('answers 404 for an unknown match and 400 for a malformed id', async () => {
    const { admin } = await setup();
    expect(
      (await cancelMatch('00000000-0000-4000-8000-000000000000', admin.token)).statusCode,
    ).toBe(404);
    expect((await cancelMatch('nope', admin.token)).statusCode).toBe(400);
  });
});

describe('cancelling: state of the match', () => {
  it('answers 409 MATCH_CANCELLED, localized, when it is already cancelled', async () => {
    const { organizer, matchId } = await setup();
    await cancelMatch(matchId, organizer.token);
    const again = await cancelMatch(matchId, organizer.token, 'uz');
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toEqual({
      code: 'MATCH_CANCELLED',
      message: 'Bu match bekor qilingan.',
    });
  });

  it('answers 409 MATCH_STARTED once the match has started', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const matchId = await insertMatch(ctx, organizer.id, {
      startsAt: new Date(Date.now() - 3600 * 1000),
    });
    const res = await cancelMatch(matchId, organizer.token);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('MATCH_STARTED');
  });

  it('notifies only once when two cancels race', async () => {
    const { organizer, admin, matchId } = await setup();
    const { player } = await confirmedPlayer(matchId, admin);
    const results = await Promise.all([
      cancelMatch(matchId, organizer.token),
      cancelMatch(matchId, admin.token),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const cancelled = (await inbox(player.id)).filter((n) => n.type === 'MATCH_CANCELLED');
    expect(cancelled).toHaveLength(1);
  });

  it('cancelling a match without registrations works', async () => {
    const { organizer, matchId } = await setup();
    expect((await cancelMatch(matchId, organizer.token)).statusCode).toBe(200);
  });
});

describe('cancelling: registrations and payments', () => {
  it('handles each payment state', async () => {
    const { organizer, admin, matchId } = await setup();

    // PAYMENT_CONFIRMED
    const paid = await confirmedPlayer(matchId, admin);
    // PAYMENT_REVIEW (receipt uploaded, not yet confirmed)
    const review = await createUser(ctx);
    const reviewReg = await apply(review.token, matchId);
    await upload(review.token, reviewReg);
    // AWAITING_PAYMENT
    const awaiting = await createUser(ctx);
    const awaitingReg = await apply(awaiting.token, matchId);
    // PAYMENT_REJECTED (receipt rejected, still inside the window)
    const rejected = await createUser(ctx);
    const rejectedReg = await apply(rejected.token, matchId);
    await upload(rejected.token, rejectedReg);
    await send('POST', `/v1/admin/registrations/${rejectedReg}/payment/reject`, admin.token, {
      reason: 'RECEIPT_UNREADABLE',
    });
    expect((await registrationRow(rejectedReg)).payment_status).toBe('PAYMENT_REJECTED');
    expect((await registrationRow(awaitingReg)).reference_code).not.toBeNull();

    expect((await cancelMatch(matchId, organizer.token)).statusCode).toBe(200);

    for (const id of [paid.registrationId, reviewReg]) {
      expect(await registrationRow(id)).toMatchObject({
        status: 'CANCELLED',
        payment_status: 'REFUND_PENDING',
        reference_code: null,
      });
      const last = (await events(id)).at(-1);
      expect(last).toMatchObject({
        event: 'REFUND_PENDING',
        to_status: 'REFUND_PENDING',
        actor_id: organizer.id,
        detail: { reason: 'MATCH_CANCELLED', matchId },
      });
    }
    expect((await events(paid.registrationId)).at(-1)?.from_status).toBe('PAYMENT_CONFIRMED');
    expect((await events(reviewReg)).at(-1)?.from_status).toBe('PAYMENT_REVIEW');

    for (const id of [awaitingReg, rejectedReg]) {
      expect(await registrationRow(id)).toMatchObject({
        status: 'CANCELLED',
        reference_code: null,
        receipt_key: null,
      });
    }
    expect((await registrationRow(awaitingReg)).payment_status).toBe('AWAITING_PAYMENT');

    // The refund screen lists exactly the two paid players, and the refund flow still works.
    const refunds = (
      await send('GET', '/v1/admin/payments?status=REFUND_PENDING', admin.token)
    ).json();
    expect(refunds.items.map((i: { registrationId: string }) => i.registrationId).sort()).toEqual(
      [paid.registrationId, reviewReg].sort(),
    );
    const refund = await send(
      'POST',
      `/v1/admin/registrations/${paid.registrationId}/payment/refund`,
      admin.token,
    );
    expect(refund.statusCode).toBe(200);
    expect(refund.json().payment.status).toBe('REFUNDED');
  });

  it('cancels free-match registrations (no payment row)', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const matchId = await insertMatch(ctx, organizer.id, { feeKrw: 0 });
    const player = await createUser(ctx);
    const registrationId = await apply(player.token, matchId);
    await cancelMatch(matchId, organizer.token);
    expect(await registrationRow(registrationId)).toMatchObject({
      status: 'CANCELLED',
      payment_status: null,
    });
    expect((await inbox(player.id)).map((n) => n.type)).toContain('MATCH_CANCELLED');
  });

  it('closes a lapsed hold silently and leaves earlier cancellations alone', async () => {
    const { organizer, matchId } = await setup();
    const lapsed = await createUser(ctx);
    const lapsedReg = await apply(lapsed.token, matchId);
    await ctx.handle.pool.query(
      `update registration_payments set due_at = now() - interval '1 hour' where registration_id = $1`,
      [lapsedReg],
    );
    const leaver = await createUser(ctx);
    const leaverReg = await apply(leaver.token, matchId);
    await send('POST', `/v1/registrations/${leaverReg}/cancel`, leaver.token);

    await cancelMatch(matchId, organizer.token);
    expect(await registrationRow(lapsedReg)).toMatchObject({ status: 'CANCELLED' });
    expect((await inbox(lapsed.id)).filter((n) => n.type === 'MATCH_CANCELLED')).toEqual([]);
    expect((await inbox(leaver.id)).filter((n) => n.type === 'MATCH_CANCELLED')).toEqual([]);
  });

  it('shows the cancelled state to the player in every place the app reads it', async () => {
    const { organizer, admin, matchId } = await setup();
    const { player, registrationId } = await confirmedPlayer(matchId, admin);
    await cancelMatch(matchId, organizer.token);

    const detail = (await send('GET', `/v1/matches/${matchId}`, player.token)).json();
    expect(detail.cancelledAt).not.toBeNull();
    expect(detail.registeredCount).toBe(0);
    expect(detail.viewer).toMatchObject({ registrationId, status: 'CANCELLED' });
    const reg = (await send('GET', `/v1/registrations/${registrationId}`, player.token)).json();
    expect(reg).toMatchObject({
      status: 'CANCELLED',
      match: { id: matchId, cancelledAt: detail.cancelledAt },
      payment: { status: 'REFUND_PENDING' },
    });
    const mine = (await send('GET', '/v1/me/registrations', player.token)).json();
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0].match.cancelledAt).toBe(detail.cancelledAt);
    const organized = (await send('GET', '/v1/me/organized-matches', organizer.token)).json();
    expect(organized.items[0]).toMatchObject({ id: matchId, cancelledAt: detail.cancelledAt });
    // Anyone can still open the page.
    expect((await send('GET', `/v1/matches/${matchId}`, null)).json().cancelledAt).not.toBeNull();
  });
});

describe('cancelling: notifications', () => {
  it('tells every affected player in their own language, with the match title', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const matchId = await insertMatch(ctx, organizer.id, { title: '서울 풋살장 5v5 매치' });
    await ctx.handle.pool.query(
      `insert into match_translations (match_id, language_code, title) values ($1, 'en', 'Seoul 5v5')`,
      [matchId],
    );
    const ko = await confirmedPlayer(matchId, admin, { preferredLanguage: 'ko' });
    const uz = await confirmedPlayer(matchId, admin, {
      preferredLanguage: 'uz',
      telegramStarted: true,
    });
    const en = await createUser(ctx, { preferredLanguage: 'en' });
    await apply(en.token, matchId);
    const before = (await inbox(ko.player.id)).length;

    await cancelMatch(matchId, organizer.token);

    const only = async (userId: string) =>
      (await inbox(userId)).filter((n) => n.type === 'MATCH_CANCELLED');
    expect(await only(ko.player.id)).toEqual([
      {
        type: 'MATCH_CANCELLED',
        language_code: 'ko',
        channel: 'IN_APP',
        title: '매치 취소',
        body: '“서울 풋살장 5v5 매치” 매치가 취소되었습니다. 입금하셨다면 환불해 드리며, 담당자가 연락드립니다.',
      },
    ]);
    expect((await inbox(ko.player.id)).length).toBe(before + 1);
    // Uzbek has no title translation: the Korean original is used. Telegram gets a copy.
    expect(await only(uz.player.id)).toEqual([
      expect.objectContaining({
        channel: 'IN_APP',
        language_code: 'uz',
        title: 'Match bekor qilindi',
        body: '“서울 풋살장 5v5 매치” matchi bekor qilindi. Agar to‘lov qilgan bo‘lsangiz, pulingiz qaytariladi; jamoamiz siz bilan bog‘lanadi.',
      }),
      expect.objectContaining({ channel: 'TELEGRAM', language_code: 'uz' }),
    ]);
    expect(await only(en.id)).toEqual([
      {
        type: 'MATCH_CANCELLED',
        language_code: 'en',
        channel: 'IN_APP',
        title: 'Match cancelled',
        body: 'The match “Seoul 5v5” was cancelled. If you paid, your payment will be refunded; the team will contact you.',
      },
    ]);
    // The organizer and the admin are not notified.
    expect(await only(organizer.id)).toEqual([]);
    expect(await only(admin.id)).toEqual([]);

    // The inbox re-renders in the language the player uses now.
    const read = (await send('GET', '/v1/me/notifications?lang=en', ko.player.token)).json();
    expect(read.items.find((n: { type: string }) => n.type === 'MATCH_CANCELLED').title).toBe(
      'Match cancelled',
    );
  });
});

describe('cancelled matches stay closed', () => {
  it('disappear from the feed and the region counts but not from the detail page', async () => {
    const { organizer, matchId } = await setup();
    const keep = await insertMatch(ctx, organizer.id, { title: 'Other' });
    const feedIds = async () =>
      (
        (await send('GET', '/v1/matches?region=seoul', null)).json() as { items: { id: string }[] }
      ).items.map((m) => m.id);
    expect(await feedIds()).toEqual(expect.arrayContaining([matchId, keep]));
    const seoul = async () =>
      (
        (await send('GET', '/v1/regions', null)).json() as {
          items: { code: string; upcomingMatches: number }[];
        }
      ).items.find((r) => r.code === 'seoul')?.upcomingMatches;
    expect(await seoul()).toBe(2);

    await cancelMatch(matchId, organizer.token);
    expect(await feedIds()).toEqual([keep]);
    expect(await seoul()).toBe(1);
    expect((await send('GET', `/v1/matches/${matchId}`, null)).statusCode).toBe(200);
  });

  it('refuses new applications with MATCH_CANCELLED', async () => {
    const { organizer, matchId } = await setup();
    await cancelMatch(matchId, organizer.token);
    const player = await createUser(ctx);
    const res = await send('POST', `/v1/matches/${matchId}/registrations?lang=en`, player.token);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toEqual({
      code: 'MATCH_CANCELLED',
      message: 'This match was cancelled.',
    });
  });

  it('refuses edits, receipts, and attendance', async () => {
    const { organizer, admin, matchId } = await setup();
    const paid = await confirmedPlayer(matchId, admin);
    const waiting = await createUser(ctx);
    const waitingReg = await apply(waiting.token, matchId);
    const translations = (
      await send('GET', `/v1/matches/${matchId}/translations`, organizer.token)
    ).json();
    expect(translations.cancelledAt).toBeNull();
    await cancelMatch(matchId, organizer.token);

    const { cancelledAt, ...input } = (
      await send('GET', `/v1/matches/${matchId}/translations`, organizer.token)
    ).json();
    expect(cancelledAt).not.toBeNull();
    const edit = await send('PUT', `/v1/matches/${matchId}`, organizer.token, {
      ...input,
      startsAt: new Date(Date.now() + 9 * 24 * 3600 * 1000).toISOString(),
      endsAt: new Date(Date.now() + 9 * 24 * 3600 * 1000 + 2 * 3600 * 1000).toISOString(),
    });
    expect(edit.statusCode).toBe(409);
    expect(edit.json().error.code).toBe('MATCH_CANCELLED');

    expect((await upload(waiting.token, waitingReg)).statusCode).toBe(409);
    const mark = await send('PUT', `/v1/matches/${matchId}/attendance`, organizer.token, {
      marks: [{ registrationId: paid.registrationId, attended: true }],
    });
    expect(mark.statusCode).toBe(409);
    expect(mark.json().error.code).toBe('MATCH_CANCELLED');
    // Nobody is left on the roster.
    const roster = (await send('GET', `/v1/matches/${matchId}/roster`, organizer.token)).json();
    expect(roster.items).toEqual([]);
  });

  it('refuses a player cancelling their registration afterwards', async () => {
    const { organizer, admin, matchId } = await setup();
    const { player, registrationId } = await confirmedPlayer(matchId, admin);
    await cancelMatch(matchId, organizer.token);
    const res = await send('POST', `/v1/registrations/${registrationId}/cancel`, player.token);
    expect(res.statusCode).toBe(409);
    expect(await registrationRow(registrationId)).toMatchObject({
      payment_status: 'REFUND_PENDING',
    });
  });

  it('ignores a cancelled match in attendance statistics and XP', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const player = await createUser(ctx);
    const startsAt = new Date(Date.now() - 5 * 24 * 3600 * 1000);
    const matchId = await insertMatch(ctx, organizer.id, { startsAt });
    const { rows } = await ctx.handle.pool.query(
      `insert into match_registrations (match_id, user_id, status, attended)
       values ($1, $2, 'CONFIRMED', true) returning id`,
      [matchId, player.id],
    );
    expect(rows).toHaveLength(1);
    const profile = async () =>
      (await send('GET', `/v1/players/${player.id}`, organizer.token)).json();
    expect((await profile()).stats).toMatchObject({ matchesPlayed: 1 });
    expect(
      (await send('GET', `/v1/players/${organizer.id}`, player.token)).json().stats,
    ).toMatchObject({
      matchesOrganized: 1,
    });

    await ctx.handle.pool.query('update matches set cancelled_at = now() where id = $1', [matchId]);
    const after = await profile();
    expect(after.stats).toMatchObject({ matchesPlayed: 0 });
    expect(after.xp).toBe(0);
    expect(after.recentMatches ?? []).toEqual([]);
    expect(
      (await send('GET', `/v1/players/${organizer.id}`, player.token)).json().stats,
    ).toMatchObject({ matchesOrganized: 0 });
    const search = (await send('GET', '/v1/players', organizer.token)).json();
    const found = search.items.find((p: { id: string }) => p.id === player.id);
    expect(found.stats?.matchesPlayed ?? 0).toBe(0);
  });
});

describe('cancelling together with a player cancelling', () => {
  it('ends in one consistent state whichever wins, over many races', async () => {
    const { organizer, admin } = await setup();
    for (let round = 0; round < 8; round++) {
      const matchId = await insertMatch(ctx, organizer.id);
      const { player, registrationId } = await confirmedPlayer(matchId, admin);
      const [byMatch, byPlayer] = await Promise.all([
        cancelMatch(matchId, organizer.token),
        send('POST', `/v1/registrations/${registrationId}/cancel`, player.token),
      ]);
      expect(byMatch.statusCode).toBe(200);
      expect([200, 409]).toContain(byPlayer.statusCode);
      expect(await registrationRow(registrationId)).toMatchObject({
        status: 'CANCELLED',
        payment_status: 'REFUND_PENDING',
      });
      // Exactly one REFUND_PENDING event: the money is never moved twice.
      const refundEvents = (await events(registrationId)).filter(
        (e) => e.event === 'REFUND_PENDING',
      );
      expect(refundEvents).toHaveLength(1);
      // Notified exactly once if the match cancel won; not at all if the player left first.
      const told = (await inbox(player.id)).filter((n) => n.type === 'MATCH_CANCELLED').length;
      expect(told).toBe(byPlayer.statusCode === 409 ? 1 : 0);
    }
  });

  it('never double-counts when applications race with the cancel', async () => {
    const { organizer, matchId } = await setup();
    const players = await Promise.all(Array.from({ length: 6 }, () => createUser(ctx)));
    const results = await Promise.all([
      ...players.map((p) => send('POST', `/v1/matches/${matchId}/registrations`, p.token)),
      cancelMatch(matchId, organizer.token),
    ]);
    expect(results.at(-1)?.statusCode).toBe(200);
    // Whoever got in before the cancel is cancelled; nobody is left holding a seat.
    const { rows } = await ctx.handle.pool.query(
      `select count(*)::int as n from match_registrations
        where match_id = $1 and status in ('APPLIED', 'CONFIRMED')`,
      [matchId],
    );
    expect(rows[0].n).toBe(0);
    const accepted = results.slice(0, -1).filter((r) => r.statusCode === 201).length;
    const { rows: told } = await ctx.handle.pool.query(
      `select count(*)::int as n from notifications where type = 'MATCH_CANCELLED' and channel = 'IN_APP'`,
    );
    expect(told[0].n).toBe(accepted);
  });
});
