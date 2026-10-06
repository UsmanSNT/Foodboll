import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LocalReceiptStorage, sniffReceiptType } from '../src/storage';
import {
  bearer,
  createUser,
  insertMatch,
  jpegBytes,
  pdfBytes,
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

const apply = (token: string, matchId: string, headers: Record<string, string> = {}) =>
  ctx.app.inject({
    method: 'POST',
    url: `/v1/matches/${matchId}/registrations`,
    headers: { ...bearer(token), ...headers },
  });
const upload = (token: string, regId: string, body: Buffer, type = 'image/png') =>
  ctx.app.inject({
    method: 'PUT',
    url: `/v1/registrations/${regId}/receipt`,
    headers: { ...bearer(token), 'content-type': type },
    payload: body,
  });
const post = (token: string, url: string, payload?: object) =>
  ctx.app.inject({ method: 'POST', url, headers: bearer(token), ...(payload && { payload }) });
const get = (token: string | null, url: string, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: 'GET', url, headers: { ...(token ? bearer(token) : {}), ...headers } });

const notificationsFor = async (userId: string) =>
  (
    await ctx.handle.pool.query(
      'select type, language_code, title, body from notifications where user_id = $1 order by created_at, type',
      [userId],
    )
  ).rows as { type: string; language_code: string; title: string; body: string }[];

async function paidSetup() {
  const organizer = await createUser(ctx, { role: 'ORGANIZER' });
  const admin = await createUser(ctx, { role: 'ADMIN', preferredLanguage: 'ko' });
  const player = await createUser(ctx, { preferredLanguage: 'uz', displayName: 'Aziz' });
  const matchId = await insertMatch(ctx, organizer.id);
  return { organizer, admin, player, matchId };
}

describe('applying to a match', () => {
  it('paid match: creates an APPLIED registration with an awaiting payment and a 24h window', async () => {
    const { player, matchId } = await paidSetup();
    const res = await apply(player.token, matchId, { 'accept-language': 'uz' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      status: 'APPLIED',
      match: { id: matchId, title: { locale: 'ko', isFallback: true } },
      payment: {
        status: 'AWAITING_PAYMENT',
        amountKrw: 10000,
        hasReceipt: false,
        rejectReason: null,
      },
    });
    // The player prefers Uzbek, so the Korean-only title is flagged as a fallback.
    const dueIn = new Date(body.payment.dueAt).getTime() - Date.now();
    expect(dueIn).toBeGreaterThan(23.9 * 3600 * 1000);
    expect(dueIn).toBeLessThanOrEqual(24 * 3600 * 1000);
    expect(await notificationsFor(player.id)).toEqual([]);
  });

  it('free match: confirmed immediately, with a notification in the player language', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const player = await createUser(ctx, { preferredLanguage: 'uz' });
    const matchId = await insertMatch(ctx, organizer.id, { feeKrw: 0 });
    const res = await apply(player.token, matchId);
    expect(res.json()).toMatchObject({ status: 'CONFIRMED', payment: null });
    expect(await notificationsFor(player.id)).toEqual([
      {
        type: 'PARTICIPATION_CONFIRMED',
        language_code: 'uz',
        title: 'Ishtirok tasdiqlandi',
        body: 'Matchdagi ishtirokingiz tasdiqlandi.',
      },
    ]);
  });

  it('rejects a second application with a localized 409', async () => {
    const { player, matchId } = await paidSetup();
    await apply(player.token, matchId);
    const again = await apply(player.token, matchId, { 'accept-language': 'uz' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toEqual({
      code: 'ALREADY_REGISTERED',
      message: 'Siz bu matchga allaqachon yozilgansiz.',
    });
  });

  it('never exceeds capacity under concurrent applications', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const matchId = await insertMatch(ctx, organizer.id, { maxPlayers: 6 });
    const players = await Promise.all(Array.from({ length: 12 }, () => createUser(ctx)));
    const results = await Promise.all(players.map((p) => apply(p.token, matchId)));
    const codes = results.map((r) => (r.statusCode === 201 ? 'ok' : r.json().error.code));
    expect(codes.filter((c) => c === 'ok')).toHaveLength(6);
    expect(codes.filter((c) => c === 'MATCH_FULL')).toHaveLength(6);
    const { rows } = await ctx.handle.pool.query(
      `select count(*)::int as n from match_registrations where match_id = $1`,
      [matchId],
    );
    expect(rows[0].n).toBe(6);
  });

  it('releases seats whose payment window expired', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const matchId = await insertMatch(ctx, organizer.id, { maxPlayers: 6 });
    const early = await Promise.all(Array.from({ length: 6 }, () => createUser(ctx)));
    for (const p of early) expect((await apply(p.token, matchId)).statusCode).toBe(201);

    const late = await createUser(ctx);
    expect((await apply(late.token, matchId)).json().error.code).toBe('MATCH_FULL');

    await ctx.handle.pool.query(
      `update registration_payments set due_at = now() - interval '1 minute'
        where registration_id in (select id from match_registrations where user_id = $1)`,
      [early[0]?.id],
    );
    expect((await apply(late.token, matchId)).statusCode).toBe(201);

    const mine = (await get(early[0]?.token ?? '', '/v1/me/registrations')).json();
    expect(mine.items[0].status).toBe('CANCELLED');
  });

  it('refuses started, unknown, and unauthenticated applications', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const player = await createUser(ctx);
    const past = await insertMatch(ctx, organizer.id, {
      startsAt: new Date(Date.now() - 3600_000),
    });
    expect((await apply(player.token, past)).json().error.code).toBe('MATCH_STARTED');
    expect((await apply(player.token, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(
      404,
    );
    const anon = await ctx.app.inject({ method: 'POST', url: `/v1/matches/${past}/registrations` });
    expect(anon.statusCode).toBe(401);
  });
});

describe('receipt upload', () => {
  it('moves the payment to review and stores the file privately', async () => {
    const { player, matchId } = await paidSetup();
    const reg = (await apply(player.token, matchId)).json();
    const res = await upload(player.token, reg.id, pngBytes());
    expect(res.statusCode).toBe(200);
    expect(res.json().payment).toMatchObject({ status: 'PAYMENT_REVIEW', hasReceipt: true });
  });

  it('accepts JPEG and PDF as well', async () => {
    const { player, organizer } = await paidSetup();
    for (const [bytes, type] of [
      [jpegBytes(), 'image/jpeg'],
      [pdfBytes(), 'application/pdf'],
    ] as const) {
      const m = await insertMatch(ctx, organizer.id);
      const reg = (await apply(player.token, m)).json();
      expect((await upload(player.token, reg.id, bytes, type)).statusCode).toBe(200);
    }
  });

  it('detects the real file type: renamed non-images are rejected', async () => {
    const { player, matchId } = await paidSetup();
    const reg = (await apply(player.token, matchId)).json();
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const res = await upload(player.token, reg.id, html, 'image/png');
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('INVALID_RECEIPT');
    expect((await upload(player.token, reg.id, Buffer.alloc(0), 'image/png')).statusCode).toBe(422);
  });

  it('rejects unsupported media types and oversized files with localized errors', async () => {
    const { player, matchId } = await paidSetup();
    const reg = (await apply(player.token, matchId)).json();
    const wrongType = await upload(player.token, reg.id, pngBytes(), 'text/plain');
    // Rejected before anything is read or stored (400/415 from the parser, or 422 from the handler).
    expect([400, 415, 422]).toContain(wrongType.statusCode);
    expect(wrongType.json().error.code).toMatch(/^(VALIDATION_FAILED|INVALID_RECEIPT)$/);
    const big = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/registrations/${reg.id}/receipt`,
      headers: { ...bearer(player.token), 'content-type': 'image/png', 'accept-language': 'uz' },
      payload: pngBytes(6 * 1024 * 1024),
    });
    expect(big.statusCode).toBe(413);
    expect(big.json().error).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Fayl juda katta. Kichikroq fayl yuklang.',
    });
  });

  it("is limited to the owner and does not reveal other people's registrations", async () => {
    const { player, matchId } = await paidSetup();
    const other = await createUser(ctx);
    const reg = (await apply(player.token, matchId)).json();
    expect((await upload(other.token, reg.id, pngBytes())).statusCode).toBe(404);
  });

  it('cannot be replaced while under review, but can after a rejection', async () => {
    const { player, admin, matchId } = await paidSetup();
    const reg = (await apply(player.token, matchId)).json();
    await upload(player.token, reg.id, pngBytes());
    expect((await upload(player.token, reg.id, pngBytes())).statusCode).toBe(409);

    await post(admin.token, `/v1/admin/registrations/${reg.id}/payment/reject`, {
      reason: 'RECEIPT_UNREADABLE',
    });
    const again = await upload(player.token, reg.id, jpegBytes(), 'image/jpeg');
    expect(again.statusCode).toBe(200);
    expect(again.json().payment).toMatchObject({ status: 'PAYMENT_REVIEW', rejectReason: null });
  });

  it('is refused after the payment window closes', async () => {
    const { player, matchId } = await paidSetup();
    const reg = (await apply(player.token, matchId)).json();
    await ctx.handle.pool.query(
      `update registration_payments set due_at = now() - interval '1 second'`,
    );
    expect((await upload(player.token, reg.id, pngBytes())).statusCode).toBe(409);
  });
});

describe('reading one registration', () => {
  it('returns it to its owner and to admins, and hides it from everyone else', async () => {
    const { player, admin, matchId } = await paidSetup();
    const stranger = await createUser(ctx);
    const reg = (await apply(player.token, matchId)).json();

    for (const token of [player.token, admin.token]) {
      const res = await get(token, `/v1/registrations/${reg.id}`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: reg.id, payment: { status: 'AWAITING_PAYMENT' } });
    }
    expect((await get(stranger.token, `/v1/registrations/${reg.id}`)).statusCode).toBe(404);
    expect((await get(player.token, `/v1/registrations/${crypto.randomUUID()}`)).statusCode).toBe(404);
    expect((await get(null, `/v1/registrations/${reg.id}`)).statusCode).toBe(401);
  });
});

describe('receipt access', () => {
  it('serves the receipt to the owner and admins with locked-down headers, and to nobody else', async () => {
    const { player, admin, matchId } = await paidSetup();
    const stranger = await createUser(ctx);
    const reg = (await apply(player.token, matchId)).json();
    expect((await get(player.token, `/v1/registrations/${reg.id}/receipt`)).statusCode).toBe(404);
    const file = pngBytes(32);
    await upload(player.token, reg.id, file);

    for (const token of [player.token, admin.token]) {
      const res = await get(token, `/v1/registrations/${reg.id}/receipt`);
      expect(res.statusCode).toBe(200);
      expect(res.rawPayload.equals(file)).toBe(true);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toContain('sandbox');
    }
    expect((await get(stranger.token, `/v1/registrations/${reg.id}/receipt`)).statusCode).toBe(404);
    expect((await get(null, `/v1/registrations/${reg.id}/receipt`)).statusCode).toBe(401);
  });
});

describe('admin payment review', () => {
  it('lists receipts waiting for review, oldest first, for admins only', async () => {
    const { player, admin, organizer } = await paidSetup();
    const second = await createUser(ctx, { preferredLanguage: 'ko', displayName: 'Minjun' });
    const m1 = await insertMatch(ctx, organizer.id, { title: '첫 번째' });
    const m2 = await insertMatch(ctx, organizer.id, { title: '두 번째' });
    const r2 = (await apply(second.token, m2)).json();
    await upload(second.token, r2.id, pngBytes());
    const r1 = (await apply(player.token, m1)).json();
    await upload(player.token, r1.id, pngBytes());
    await apply((await createUser(ctx)).token, m1); // awaiting: must not be listed

    const res = await get(admin.token, '/v1/admin/payments');
    expect(res.statusCode).toBe(200);
    expect(
      res.json().items.map((i: { user: { displayName: string } }) => i.user.displayName),
    ).toEqual(['Minjun', 'Aziz']);
    expect(res.json().items[1]).toMatchObject({
      user: { preferredLanguage: 'uz' },
      registrationStatus: 'APPLIED',
      payment: { status: 'PAYMENT_REVIEW', amountKrw: 10000 },
    });
    expect((await get(player.token, '/v1/admin/payments')).statusCode).toBe(403);
  });

  it('confirming confirms participation and notifies the player in their language', async () => {
    const { player, admin, matchId } = await paidSetup();
    const reg = (await apply(player.token, matchId)).json();
    await upload(player.token, reg.id, pngBytes());

    const res = await post(admin.token, `/v1/admin/registrations/${reg.id}/payment/confirm`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      registrationStatus: 'CONFIRMED',
      payment: { status: 'PAYMENT_CONFIRMED' },
    });

    const mine = (await get(player.token, '/v1/me/registrations')).json();
    expect(mine.items[0]).toMatchObject({
      status: 'CONFIRMED',
      payment: { status: 'PAYMENT_CONFIRMED' },
    });

    expect(
      (await notificationsFor(player.id)).map((n) => [n.type, n.language_code, n.body]).sort(),
    ).toEqual([
      ['PARTICIPATION_CONFIRMED', 'uz', 'Matchdagi ishtirokingiz tasdiqlandi.'],
      ['PAYMENT_CONFIRMED', 'uz', 'To‘lovingiz tasdiqlandi.'],
    ]);

    expect(
      (await post(admin.token, `/v1/admin/registrations/${reg.id}/payment/confirm`)).statusCode,
    ).toBe(409);
  });

  it('rejecting sends the reason in the player language (Uzbek and Korean)', async () => {
    const { admin, organizer } = await paidSetup();
    const uz = await createUser(ctx, { preferredLanguage: 'uz' });
    const ko = await createUser(ctx, { preferredLanguage: 'ko' });
    const m = await insertMatch(ctx, organizer.id);
    for (const p of [uz, ko]) {
      const reg = (await apply(p.token, m)).json();
      await upload(p.token, reg.id, pngBytes());
      const res = await post(admin.token, `/v1/admin/registrations/${reg.id}/payment/reject`, {
        reason: 'AMOUNT_MISMATCH',
      });
      expect(res.json().payment).toMatchObject({
        status: 'PAYMENT_REJECTED',
        rejectReason: 'AMOUNT_MISMATCH',
      });
    }
    expect((await notificationsFor(uz.id))[0]).toMatchObject({
      type: 'PAYMENT_REJECTED',
      language_code: 'uz',
      title: 'To‘lov tasdiqlanmadi',
      body: 'To‘lovni tasdiqlab bo‘lmadi. Sabab: To‘lov summasi mos kelmadi. Chekni qayta yuklang.',
    });
    expect((await notificationsFor(ko.id))[0]).toMatchObject({
      language_code: 'ko',
      body: '입금을 확인하지 못했습니다. 사유: 입금 금액이 일치하지 않습니다. 영수증을 다시 업로드해주세요.',
    });
  });

  it('validates the rejection reason and requires a receipt under review', async () => {
    const { player, admin, matchId } = await paidSetup();
    const reg = (await apply(player.token, matchId)).json();
    const url = `/v1/admin/registrations/${reg.id}/payment`;
    expect(
      (await post(admin.token, `${url}/reject`, { reason: 'Because I said so' })).statusCode,
    ).toBe(400);
    expect((await post(admin.token, `${url}/reject`, { reason: 'OTHER' })).statusCode).toBe(409);
    expect((await post(admin.token, `${url}/confirm`)).statusCode).toBe(409);
    expect((await post(player.token, `${url}/confirm`)).statusCode).toBe(403);
  });
});

describe('cancelling and refunds', () => {
  it('cancelling frees the seat', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const matchId = await insertMatch(ctx, organizer.id, { maxPlayers: 6 });
    const players = await Promise.all(Array.from({ length: 7 }, () => createUser(ctx)));
    const regs = [];
    for (const p of players.slice(0, 6)) regs.push((await apply(p.token, matchId)).json());
    const last = players[6];
    expect((await apply(last?.token ?? '', matchId)).json().error.code).toBe('MATCH_FULL');

    const res = await post(players[0]?.token ?? '', `/v1/registrations/${regs[0].id}/cancel`);
    expect(res.json().status).toBe('CANCELLED');
    expect((await apply(last?.token ?? '', matchId)).statusCode).toBe(201);
    expect(
      (await post(players[0]?.token ?? '', `/v1/registrations/${regs[0].id}/cancel`)).statusCode,
    ).toBe(409);
  });

  it('only the owner can cancel, and not after kick-off', async () => {
    const { player, matchId } = await paidSetup();
    const other = await createUser(ctx);
    const reg = (await apply(player.token, matchId)).json();
    expect((await post(other.token, `/v1/registrations/${reg.id}/cancel`)).statusCode).toBe(404);
    await ctx.handle.pool.query(`update matches set starts_at = now() - interval '1 minute'`);
    expect((await post(player.token, `/v1/registrations/${reg.id}/cancel`)).json().error.code).toBe(
      'MATCH_STARTED',
    );
  });

  it('a paid player who cancels can only re-apply after an admin refunds', async () => {
    const { player, admin, matchId } = await paidSetup();
    const reg = (await apply(player.token, matchId)).json();
    await upload(player.token, reg.id, pngBytes());
    await post(admin.token, `/v1/admin/registrations/${reg.id}/payment/confirm`);

    const refundUrl = `/v1/admin/registrations/${reg.id}/payment/refund`;
    expect((await post(admin.token, refundUrl)).statusCode).toBe(409); // not cancelled yet
    await post(player.token, `/v1/registrations/${reg.id}/cancel`);
    expect((await apply(player.token, matchId)).json().error.code).toBe('INVALID_STATE');

    const refunded = await post(admin.token, refundUrl);
    expect(refunded.json().payment.status).toBe('REFUNDED');

    const again = await apply(player.token, matchId);
    expect(again.statusCode).toBe(201);
    expect(again.json()).toMatchObject({
      id: reg.id,
      status: 'APPLIED',
      payment: { status: 'AWAITING_PAYMENT', hasReceipt: false },
    });
  });

  it('lets an unpaid player cancel and re-apply with a fresh payment', async () => {
    const { player, matchId } = await paidSetup();
    const reg = (await apply(player.token, matchId)).json();
    await post(player.token, `/v1/registrations/${reg.id}/cancel`);
    expect((await apply(player.token, matchId)).statusCode).toBe(201);
  });
});

describe('my registrations', () => {
  it('lists only my registrations with localized match titles', async () => {
    const { player, organizer, matchId } = await paidSetup();
    const other = await createUser(ctx);
    await apply(player.token, matchId);
    await apply(other.token, await insertMatch(ctx, organizer.id));
    const res = await get(player.token, '/v1/me/registrations?lang=ko');
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0].match.title).toEqual({
      text: '서울 풋살장 5v5 매치',
      locale: 'ko',
      isFallback: false,
    });
    expect((await get(null, '/v1/me/registrations')).statusCode).toBe(401);
  });
});

describe('receipt storage', () => {
  it('detects file types from bytes', () => {
    expect(sniffReceiptType(pngBytes())).toBe('image/png');
    expect(sniffReceiptType(jpegBytes())).toBe('image/jpeg');
    expect(sniffReceiptType(pdfBytes())).toBe('application/pdf');
    expect(sniffReceiptType(Buffer.from('GIF89a'))).toBeNull();
    expect(sniffReceiptType(Buffer.alloc(0))).toBeNull();
  });

  it('refuses keys that could escape the storage directory', async () => {
    const storage = new LocalReceiptStorage(ctx.config.receiptDir);
    const key = await storage.put(pngBytes(), 'image/png');
    expect(await storage.get(key)).not.toBeNull();
    for (const bad of [
      '../../etc/passwd',
      '..%2f..%2fetc%2fpasswd',
      `../${key}`,
      `${key}/../${key}`,
      '',
    ]) {
      expect(await storage.get(bad)).toBeNull();
      await expect(storage.delete(bad)).resolves.toBeUndefined();
    }
    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
  });
});
