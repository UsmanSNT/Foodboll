/**
 * Prints the SQL that seeds `regions` and `region_translations` from REGION_SEEDS.
 * Used once to author a migration (migrations are immutable afterwards); a test asserts the
 * database still equals REGION_SEEDS. Usage: pnpm tsx scripts/regions-sql.ts [ko,uz,...]
 */
import { REGION_SEEDS } from '@foodboll/contracts';

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
const languages = (process.argv[2] ?? 'ko,uz').split(',') as ('ko' | 'uz' | 'en')[];

const level1 = REGION_SEEDS.filter((r) => r.parent === null);
const level2 = REGION_SEEDS.filter((r) => r.parent !== null);

const lines: string[] = [];
lines.push(
  `INSERT INTO "regions" ("code", "level", "sort_order") VALUES\n` +
    level1.map((r) => `\t(${q(r.code)}, 1, ${r.sortOrder})`).join(',\n') +
    ';',
);
lines.push(
  `INSERT INTO "regions" ("code", "parent_id", "level", "sort_order")\n` +
    `SELECT v.code, p.id, 2, v.sort_order FROM (VALUES\n` +
    level2.map((r) => `\t(${q(r.code)}, ${q(r.parent ?? '')}, ${r.sortOrder})`).join(',\n') +
    `\n) AS v(code, parent, sort_order) JOIN "regions" p ON p.code = v.parent;`,
);
const names = REGION_SEEDS.flatMap((r) => languages.map((l) => `\t(${q(r.code)}, ${q(l)}, ${q(r.names[l])})`));
lines.push(
  `INSERT INTO "region_translations" ("region_id", "language_code", "name")\n` +
    `SELECT r.id, v.lang, v.name FROM (VALUES\n${names.join(',\n')}\n) AS v(code, lang, name) JOIN "regions" r ON r.code = v.code;`,
);
console.log(lines.join('\n--> statement-breakpoint\n'));
