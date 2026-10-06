import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createUser, startTestApp, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await startTestApp();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.reset());

const bankless = {
  accountNumber: '123-456-789012',
  accountHolder: 'FOOTBALL TEAM',
};
const both = {
  ...bankless,
  translations: {
    ko: { bankName: '국민은행', instructions: '입금 후 영수증을 업로드해주세요.' },
    uz: {
      bankName: 'Kookmin Bank',
      instructions: 'To‘lovni amalga oshirgandan so‘ng chekni yuklang.',
    },
  },
};

const put = (token: string, url: string, payload: unknown, headers: Record<string, string> = {}) =>
  ctx.app.inject({
    method: 'PUT',
    url,
    headers: { ...bearer(token), ...headers },
    payload: payload as object,
  });
const get = (url: string, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: 'GET', url, headers });

describe('payment instructions', () => {
  it('serves Korean and Uzbek versions; account number and holder are untranslated', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    expect((await put(admin.token, '/v1/admin/payment-instructions', both)).statusCode).toBe(200);

    const uz = await createUser(ctx, { preferredLanguage: 'uz' });
    const ko = await createUser(ctx, { preferredLanguage: 'ko' });

    expect((await get('/v1/payment-instructions/current', bearer(uz.token))).json()).toMatchObject({
      bankName: { text: 'Kookmin Bank', locale: 'uz', isFallback: false },
      accountNumber: '123-456-789012',
      accountHolder: 'FOOTBALL TEAM',
      instructions: { text: 'To‘lovni amalga oshirgandan so‘ng chekni yuklang.', locale: 'uz' },
    });
    expect((await get('/v1/payment-instructions/current', bearer(ko.token))).json()).toMatchObject({
      bankName: { text: '국민은행', locale: 'ko', isFallback: false },
      instructions: { text: '입금 후 영수증을 업로드해주세요.' },
    });
  });

  it('never blocks payment: a missing Uzbek version falls back to Korean and is flagged to admins', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const koOnly = { ...bankless, translations: { ko: both.translations.ko } };
    const saved = await put(admin.token, '/v1/admin/payment-instructions', koOnly);
    expect(saved.json().missingLanguages).toEqual(['uz', 'en']);

    const uz = await createUser(ctx, { preferredLanguage: 'uz' });
    const view = (await get('/v1/payment-instructions/current', bearer(uz.token))).json();
    expect(view.bankName).toEqual({ text: '국민은행', locale: 'ko', isFallback: true });
    expect(view.accountNumber).toBe('123-456-789012');

    const complete = await put(admin.token, '/v1/admin/payment-instructions', both);
    expect(complete.json().missingLanguages).toEqual(['en']);
    const everything = await put(admin.token, '/v1/admin/payment-instructions', {
      ...both,
      translations: {
        ...both.translations,
        en: { bankName: 'Kookmin Bank', instructions: 'Upload your receipt after paying.' },
      },
    });
    expect(everything.json().missingLanguages).toEqual([]);
  });

  it('requires the Korean text and rejects other languages', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const uzOnly = await put(admin.token, '/v1/admin/payment-instructions', {
      ...bankless,
      translations: { uz: both.translations.uz },
    });
    expect(uzOnly.statusCode).toBe(422);
    expect(uzOnly.json().error.code).toBe('SOURCE_TRANSLATION_REQUIRED');
    const english = await put(admin.token, '/v1/admin/payment-instructions', {
      ...bankless,
      translations: { ...both.translations, fr: { bankName: 'x', instructions: 'y' } },
    });
    expect(english.statusCode).toBe(400);
  });

  it('keeps history and exactly one active row when replaced', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    await put(admin.token, '/v1/admin/payment-instructions', both);
    await put(admin.token, '/v1/admin/payment-instructions', {
      ...both,
      accountNumber: '999-888-777666',
    });
    const { rows } = await ctx.handle.pool.query(
      'select account_number, is_active from payment_instructions order by created_at',
    );
    expect(rows).toEqual([
      { account_number: '123-456-789012', is_active: false },
      { account_number: '999-888-777666', is_active: true },
    ]);
  });

  it('serializes concurrent admin updates', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        put(admin.token, '/v1/admin/payment-instructions', {
          ...both,
          accountNumber: `100-200-30000${i}`,
        }),
      ),
    );
    expect(results.map((r) => r.statusCode)).toEqual(Array(6).fill(200));
    const { rows } = await ctx.handle.pool.query(
      'select count(*)::int as n from payment_instructions where is_active',
    );
    expect(rows[0].n).toBe(1);
  });

  it('is 404 before anything is configured, and needs authentication', async () => {
    const player = await createUser(ctx);
    const none = await get('/v1/payment-instructions/current?lang=uz', bearer(player.token));
    expect(none.statusCode).toBe(404);
    expect(none.json().error.message).toBe('To‘lov bo‘yicha ma’lumot hali kiritilmagan.');
    expect((await get('/v1/payment-instructions/current')).statusCode).toBe(401);
  });

  it('only admins can change or read the editor view', async () => {
    const organizer = await createUser(ctx, { role: 'ORGANIZER' });
    expect((await put(organizer.token, '/v1/admin/payment-instructions', both)).statusCode).toBe(
      403,
    );
    expect(
      (await get('/v1/admin/payment-instructions/current', bearer(organizer.token))).statusCode,
    ).toBe(403);
  });
});

describe('legal documents', () => {
  const doc = {
    translations: {
      ko: { title: '개인정보 처리방침', body: '제1조 …' },
      uz: { title: 'Maxfiylik siyosati', body: '1-modda …' },
    },
  };

  it('publishes immutable versions and serves the latest in the reader language', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const v1 = await put(admin.token, '/v1/admin/legal/PRIVACY', doc);
    expect(v1.statusCode).toBe(201);
    expect(v1.json().version).toBe(1);
    const v2 = await put(admin.token, '/v1/admin/legal/PRIVACY', {
      translations: { ko: { title: '개인정보 처리방침 v2', body: '개정' } },
    });
    expect(v2.json().version).toBe(2);

    const uz = (await get('/v1/legal/PRIVACY?lang=uz')).json();
    // v2 has no Uzbek text yet: the reader gets the Korean original, flagged.
    expect(uz.version).toBe(2);
    expect(uz.title).toEqual({ text: '개인정보 처리방침 v2', locale: 'ko', isFallback: true });
    expect(uz.body.isFallback).toBe(true);

    const rows = await ctx.handle.pool.query(
      'select version from legal_documents order by version',
    );
    expect(rows.rows).toEqual([{ version: 1 }, { version: 2 }]);
  });

  it('serves a complete document without fallback', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    await put(admin.token, '/v1/admin/legal/TERMS', doc);
    const uz = (await get('/v1/legal/TERMS?lang=uz')).json();
    expect(uz.title).toEqual({ text: 'Maxfiylik siyosati', locale: 'uz', isFallback: false });
  });

  it('assigns unique versions under concurrent publishing', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => put(admin.token, '/v1/admin/legal/REFUND', doc)),
    );
    expect(results.map((r) => r.statusCode)).toEqual(Array(5).fill(201));
    const rows = await ctx.handle.pool.query(
      'select version from legal_documents where type = $1 order by version',
      ['REFUND'],
    );
    expect(rows.rows.map((r: { version: number }) => r.version)).toEqual([1, 2, 3, 4, 5]);
  });

  it('validates the document type and requires Korean', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    expect((await get('/v1/legal/NOPE')).statusCode).toBe(400);
    expect((await get('/v1/legal/TERMS?lang=uz')).json().error.code).toBe(
      'LEGAL_DOCUMENT_NOT_FOUND',
    );
    const uzOnly = await put(admin.token, '/v1/admin/legal/TERMS', {
      translations: { uz: doc.translations.uz },
    });
    expect(uzOnly.statusCode).toBe(422);
  });

  it('is admin-only to publish', async () => {
    const player = await createUser(ctx);
    expect((await put(player.token, '/v1/admin/legal/TERMS', doc)).statusCode).toBe(403);
  });
});
