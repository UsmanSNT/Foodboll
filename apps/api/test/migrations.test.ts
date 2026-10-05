import { LOCALES, LOCALE_CODES } from '@foodboll/i18n';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await startTestApp();
});
afterAll(() => ctx.close());

describe('database schema', () => {
  it('seeds exactly the languages the i18n registry supports', async () => {
    const { rows } = await ctx.handle.pool.query(
      'select code, native_name, english_name, enabled from languages order by sort_order',
    );
    expect(rows).toEqual(
      LOCALE_CODES.map((code) => ({
        code,
        native_name: LOCALES[code].nativeName,
        english_name: LOCALES[code].englishName,
        enabled: true,
      })),
    );
  });

  it('does not collect nationality', async () => {
    const { rows } = await ctx.handle.pool.query(
      `select column_name from information_schema.columns where table_name = 'users'`,
    );
    const columns = rows.map((r: { column_name: string }) => r.column_name);
    expect(columns).toContain('preferred_language');
    expect(columns.filter((c: string) => /national|citizen|country/i.test(c))).toEqual([]);
  });

  it('rejects an unknown preferred language at the database level', async () => {
    await expect(
      ctx.handle.pool.query(
        `insert into users (display_name, preferred_language) values ('x', 'zz')`,
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  it('allows adding a language without a schema change', async () => {
    await ctx.handle.pool.query(
      `insert into languages (code, native_name, english_name, enabled, sort_order) values ('vi', 'Tiếng Việt', 'Vietnamese', false, 99)`,
    );
    await expect(
      ctx.handle.pool.query(
        `insert into users (display_name, preferred_language) values ('x', 'vi')`,
      ),
    ).resolves.toBeDefined();
    await ctx.handle.pool.query(`delete from users where display_name = 'x'`);
    await ctx.handle.pool.query(`delete from languages where code = 'vi'`);
  });

  it('rejects malformed language codes', async () => {
    await expect(
      ctx.handle.pool.query(
        `insert into languages (code, native_name, english_name) values ('KO!', 'x', 'x')`,
      ),
    ).rejects.toThrow(/languages_code_format/);
  });
});
