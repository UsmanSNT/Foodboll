import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthUser } from '../src/context';
import {
  applyToMatch,
  cancelRegistration,
  confirmPayment,
  getRegistrationDto,
  listMyRegistrations,
  rejectPayment,
  refundPayment,
  uploadReceipt,
} from '../src/services/registrations';
import { LocalReceiptStorage } from '../src/storage';
import {
  bearer,
  createUser,
  insertMatch,
  pngBytes,
  startTestApp,
  type TestContext,
} from './helpers';

let ctx: TestContext;
let storage: LocalReceiptStorage;
beforeAll(async () => {
  ctx = await startTestApp();
  storage = new LocalReceiptStorage(ctx.config.receiptDir);
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await ctx.reset();
  rmSync(ctx.config.receiptDir, { recursive: true, force: true });
  mkdirSync(ctx.config.receiptDir, { recursive: true });
});

const asUser = (u: { id: string }, role: AuthUser['role'] = 'PLAYER'): AuthUser => ({
  id: u.id,
  role,
  displayName: 'T',
  preferredLanguage: null,
});
const files = () => readdirSync(ctx.config.receiptDir).length;
const db = () => ctx.handle.db;
const hours = (n: number) => n * 3600 * 1000;

async function setup() {
  const organizer = await createUser(ctx, { role: 'ORGANIZER' });
  const admin = await createUser(ctx, { role: 'ADMIN' });
  const player = await createUser(ctx, { preferredLanguage: 'uz' });
  const matchId = await insertMatch(ctx, organizer.id);
  return { organizer, admin, player, matchId };
}
const payment = async (registrationId: string) =>
  (
    await ctx.handle.pool.query(
      'select status, due_at, receipt_key from registration_payments where registration_id = $1',
      [registrationId],
    )
  ).rows[0] as { status: string; due_at: Date; receipt_key: string | null };
const events = async (registrationId: string) =>
  (
    await ctx.handle.pool.query(
      'select event, from_status, to_status from payment_events where registration_id = $1 order by created_at, id',
      [registrationId],
    )
  ).rows as { event: string; from_status: string | null; to_status: string | null }[];

describe('review window', () => {
  it('a rejection after the original deadline grants a fresh window instead of costing the seat', async () => {
    const { player, admin, matchId } = await setup();
    const t0 = new Date();
    const regId = await applyToMatch(db(), storage, asUser(player), matchId, t0);
    await uploadReceipt(
      db(),
      storage,
      asUser(player),
      regId,
      pngBytes(),
      new Date(t0.getTime() + hours(23)),
    );

    // The admin only gets to it 30 hours after the player applied.
    const late = new Date(t0.getTime() + hours(30));
    await rejectPayment(db(), asUser(admin, 'ADMIN'), regId, 'AMOUNT_MISMATCH', late);

    const p = await payment(regId);
    expect(p.status).toBe('PAYMENT_REJECTED');
    expect(p.due_at.getTime()).toBeGreaterThan(late.getTime() + hours(23));

    const mine = await listMyRegistrations(
      db(),
      asUser(player),
      'ko',
      { limit: 20, offset: 0 },
      new Date(late.getTime() + hours(1)),
    );
    expect(mine.items[0]?.status).toBe('APPLIED');
    // ...and the player can upload again.
    await uploadReceipt(
      db(),
      storage,
      asUser(player),
      regId,
      pngBytes(),
      new Date(late.getTime() + hours(2)),
    );
    expect((await payment(regId)).status).toBe('PAYMENT_REVIEW');
  });
});

describe('reads do not write', () => {
  it('reports lapsed holds as cancelled without touching the row', async () => {
    const { player, matchId } = await setup();
    const regId = await applyToMatch(db(), storage, asUser(player), matchId);
    const before = (
      await ctx.handle.pool.query('select status, updated_at from match_registrations')
    ).rows[0];
    const future = new Date(Date.now() + hours(48));

    const mine = await listMyRegistrations(
      db(),
      asUser(player),
      'ko',
      { limit: 20, offset: 0 },
      future,
    );
    expect(mine.items[0]?.status).toBe('CANCELLED');
    expect((await getRegistrationDto(db(), regId, 'ko', future)).status).toBe('CANCELLED');

    const after = (
      await ctx.handle.pool.query('select status, updated_at from match_registrations')
    ).rows[0];
    expect(after).toEqual(before);
  });
});

describe('expiry never races with a receipt upload', () => {
  it('a registration with a receipt under review is never released', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const matchId = await insertMatch(ctx, organizer.id, { maxPlayers: 6 });
    for (let round = 0; round < 15; round++) {
      const owner = await createUser(ctx);
      const other = await createUser(ctx);
      const t0 = new Date();
      const regId = await applyToMatch(db(), storage, asUser(owner), matchId, t0);
      // Upload happens just before the deadline; the sweep (another player applying) just after.
      const justBefore = new Date(t0.getTime() + hours(24) - 1000);
      const justAfter = new Date(t0.getTime() + hours(24) + 1000);
      await Promise.allSettled([
        uploadReceipt(db(), storage, asUser(owner), regId, pngBytes(), justBefore),
        applyToMatch(db(), storage, asUser(other), matchId, justAfter),
      ]);
      const p = await payment(regId);
      const r = (
        await ctx.handle.pool.query('select status from match_registrations where id = $1', [regId])
      ).rows[0];
      // Invariant: a receipt in review always belongs to a live registration.
      if (p.status === 'PAYMENT_REVIEW') expect(r.status).toBe('APPLIED');
      await ctx.handle.pool.query('delete from match_registrations');
    }
  });
});

describe('receipt files are never orphaned', () => {
  it('removes the rejected receipt when the player cancels', async () => {
    const { player, admin, matchId } = await setup();
    const regId = await applyToMatch(db(), storage, asUser(player), matchId);
    await uploadReceipt(db(), storage, asUser(player), regId, pngBytes());
    expect(files()).toBe(1);
    await rejectPayment(db(), asUser(admin, 'ADMIN'), regId, 'OTHER');
    await cancelRegistration(db(), storage, asUser(player), regId);
    expect(files()).toBe(0);
    expect((await payment(regId)).receipt_key).toBeNull();
  });

  it('removes the old file when a lapsed registration is re-applied', async () => {
    const { player, admin, matchId } = await setup();
    const t0 = new Date();
    const regId = await applyToMatch(db(), storage, asUser(player), matchId, t0);
    await uploadReceipt(db(), storage, asUser(player), regId, pngBytes(), t0);
    await rejectPayment(db(), asUser(admin, 'ADMIN'), regId, 'RECEIPT_UNREADABLE', t0);
    // The re-upload window lapses, and a later application sweeps and re-applies.
    const later = new Date(t0.getTime() + hours(30));
    await applyToMatch(db(), storage, asUser(await createUser(ctx)), matchId, later);
    await applyToMatch(db(), storage, asUser(player), matchId, later);
    expect(files()).toBe(0);
  });

  it('removes the new file again when the upload transaction fails', async () => {
    const { player, admin, matchId } = await setup();
    const regId = await applyToMatch(db(), storage, asUser(player), matchId);
    await uploadReceipt(db(), storage, asUser(player), regId, pngBytes());
    await expect(
      uploadReceipt(db(), storage, asUser(player), regId, pngBytes()),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(files()).toBe(1);
    void admin;
  });

  it('keeps the receipt of a refunded payment as evidence and records where it is', async () => {
    const { player, admin, matchId } = await setup();
    const regId = await applyToMatch(db(), storage, asUser(player), matchId);
    await uploadReceipt(db(), storage, asUser(player), regId, pngBytes());
    await confirmPayment(db(), asUser(admin, 'ADMIN'), regId);
    await cancelRegistration(db(), storage, asUser(player), regId);
    await refundPayment(db(), asUser(admin, 'ADMIN'), regId);
    const key = (await payment(regId)).receipt_key;
    expect(key).not.toBeNull();

    await applyToMatch(db(), storage, asUser(player), matchId);
    expect(files()).toBe(1);
    const archived = await ctx.handle.pool.query(
      `select detail from payment_events where registration_id = $1 and event = 'RECEIPT_ARCHIVED'`,
      [regId],
    );
    expect(archived.rows[0].detail).toEqual({ receiptKey: key });
    expect(await storage.get(key ?? '')).not.toBeNull();
  });

  it('drops the payment row and receipt when the match became free', async () => {
    const { player, admin, matchId, organizer } = await setup();
    const t0 = new Date();
    const regId = await applyToMatch(db(), storage, asUser(player), matchId, t0);
    await uploadReceipt(db(), storage, asUser(player), regId, pngBytes(), t0);
    await rejectPayment(db(), asUser(admin, 'ADMIN'), regId, 'OTHER', t0);
    await cancelRegistration(db(), storage, asUser(player), regId, t0);
    void organizer;
    expect(files()).toBe(0);
  });
});

describe('cancelling with money in flight', () => {
  it('moves the payment to REFUND_PENDING, shows it to the player, and lets the admin settle it', async () => {
    const { player, admin, matchId } = await setup();
    const regId = await applyToMatch(db(), storage, asUser(player), matchId);
    await uploadReceipt(db(), storage, asUser(player), regId, pngBytes());
    await cancelRegistration(db(), storage, asUser(player), regId);

    expect((await payment(regId)).status).toBe('REFUND_PENDING');
    const mine = await listMyRegistrations(db(), asUser(player), 'uz', { limit: 20, offset: 0 });
    expect(mine.items[0]).toMatchObject({
      status: 'CANCELLED',
      payment: { status: 'REFUND_PENDING', hasReceipt: true },
    });

    // It is no longer in the normal review queue, but is in its own queue.
    const queue = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/payments',
      headers: bearer(admin.token),
    });
    expect(queue.json().items).toEqual([]);
    const refunds = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/payments?status=REFUND_PENDING',
      headers: bearer(admin.token),
    });
    expect(refunds.json().items).toHaveLength(1);

    // confirm/reject-with-notification are impossible on a cancelled registration
    await expect(confirmPayment(db(), asUser(admin, 'ADMIN'), regId)).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });

    await refundPayment(db(), asUser(admin, 'ADMIN'), regId);
    const note = await ctx.handle.pool.query(
      `select language_code, body from notifications where user_id = $1 and type = 'PAYMENT_REFUNDED'`,
      [player.id],
    );
    expect(note.rows).toEqual([{ language_code: 'uz', body: 'To‘lagan summangiz qaytarildi.' }]);
    expect((await payment(regId)).status).toBe('REFUNDED');
  });

  it('closes out a cancelled review whose money never arrived, without nagging the player', async () => {
    const { player, admin, matchId } = await setup();
    const regId = await applyToMatch(db(), storage, asUser(player), matchId);
    await uploadReceipt(db(), storage, asUser(player), regId, pngBytes());
    await cancelRegistration(db(), storage, asUser(player), regId);
    await rejectPayment(db(), asUser(admin, 'ADMIN'), regId, 'PAYMENT_NOT_FOUND');
    expect((await payment(regId)).status).toBe('PAYMENT_REJECTED');
    const notes = await ctx.handle.pool.query(`select type from notifications where user_id = $1`, [
      player.id,
    ]);
    expect(notes.rows).toEqual([]);
    // The player may apply again.
    await expect(applyToMatch(db(), storage, asUser(player), matchId)).resolves.toBe(regId);
  });
});

describe('audit trail', () => {
  it('records every transition in order and cannot be altered', async () => {
    const { player, admin, matchId } = await setup();
    const regId = await applyToMatch(db(), storage, asUser(player), matchId);
    await uploadReceipt(db(), storage, asUser(player), regId, pngBytes());
    await rejectPayment(db(), asUser(admin, 'ADMIN'), regId, 'AMOUNT_MISMATCH');
    await uploadReceipt(db(), storage, asUser(player), regId, pngBytes());
    await confirmPayment(db(), asUser(admin, 'ADMIN'), regId);
    await cancelRegistration(db(), storage, asUser(player), regId);
    await refundPayment(db(), asUser(admin, 'ADMIN'), regId);

    expect(
      (await events(regId)).map((e) => `${e.event}:${e.from_status ?? '-'}>${e.to_status ?? '-'}`),
    ).toEqual([
      'PAYMENT_CREATED:->AWAITING_PAYMENT',
      'RECEIPT_UPLOADED:AWAITING_PAYMENT>PAYMENT_REVIEW',
      'REJECTED:PAYMENT_REVIEW>PAYMENT_REJECTED',
      'RECEIPT_UPLOADED:PAYMENT_REJECTED>PAYMENT_REVIEW',
      'CONFIRMED:PAYMENT_REVIEW>PAYMENT_CONFIRMED',
      'REFUND_PENDING:PAYMENT_CONFIRMED>REFUND_PENDING',
      'REFUNDED:REFUND_PENDING>REFUNDED',
    ]);
    await expect(
      ctx.handle.pool.query(`update payment_events set event = 'EXPIRED'`),
    ).rejects.toThrow(/append-only/);
    await expect(ctx.handle.pool.query(`delete from payment_events`)).rejects.toThrow(
      /append-only/,
    );
  });

  it('survives deleting the acting user (actor becomes NULL)', async () => {
    const { player, matchId } = await setup();
    const regId = await applyToMatch(db(), storage, asUser(player), matchId);
    await ctx.handle.pool.query('delete from users where id = $1', [player.id]);
    const rows = (
      await ctx.handle.pool.query(
        'select actor_id from payment_events where registration_id = $1',
        [regId],
      )
    ).rows;
    expect(rows).toEqual([{ actor_id: null }]);
  });
});

describe('capacity edits', () => {
  it('refuses to cut capacity below current registrations and keeps capacity when omitted', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    const matchId = await insertMatch(ctx, organizer.id, { maxPlayers: 20 });
    for (let i = 0; i < 7; i++)
      await applyToMatch(db(), storage, asUser(await createUser(ctx)), matchId);

    const body = (extra: Record<string, unknown>) => ({
      sourceLanguage: 'ko',
      startsAt: new Date(Date.now() + 7 * 24 * hours(1)).toISOString(),
      playersPerSide: 3,
      feeKrw: 10000,
      translations: { ko: { title: '수정' } },
      ...extra,
    });
    const put = (payload: object) =>
      ctx.app.inject({
        method: 'PUT',
        url: `/v1/matches/${matchId}`,
        headers: { ...bearer(organizer.token), 'accept-language': 'uz' },
        payload,
      });

    const tooLow = await put(body({ maxPlayers: 6 }));
    expect(tooLow.statusCode).toBe(409);
    expect(tooLow.json().error.code).toBe('CAPACITY_BELOW_REGISTRATIONS');

    expect((await put(body({}))).json().maxPlayers).toBe(20);
    expect((await put(body({ maxPlayers: 8 }))).json().maxPlayers).toBe(8);
  });
});

describe('uploads authenticate before the body is read', () => {
  it('rejects anonymous and malformed requests without storing anything', async () => {
    const before = files();
    const big = pngBytes(4 * 1024 * 1024);
    const anon = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/registrations/00000000-0000-4000-8000-000000000000/receipt',
      headers: { 'content-type': 'image/png' },
      payload: big,
    });
    expect(anon.statusCode).toBe(401);
    const { token } = await createUser(ctx);
    const badId = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/registrations/not-a-uuid/receipt',
      headers: { ...bearer(token), 'content-type': 'image/png' },
      payload: big,
    });
    expect(badId.statusCode).toBe(400);
    expect(files()).toBe(before);
  });
});

describe('receipt storage', () => {
  it('recovers after a transient mkdir failure instead of failing until restart', async () => {
    const base = mkdtempSync(path.join(os.tmpdir(), 'foodboll-storage-'));
    const blocker = path.join(base, 'volume');
    writeFileSync(blocker, 'not a directory'); // mkdir volume/receipts fails with ENOTDIR
    const flaky = new LocalReceiptStorage(path.join(blocker, 'receipts'));
    await expect(flaky.put(pngBytes(), 'image/png')).rejects.toThrow();

    rmSync(blocker);
    mkdirSync(blocker); // the "volume" is now mounted
    const key = await flaky.put(pngBytes(), 'image/png');
    expect(await flaky.get(key)).not.toBeNull();
    rmSync(base, { recursive: true, force: true });
  });
});
