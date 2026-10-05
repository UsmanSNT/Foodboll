import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db } from './client';

/** `drizzle/` sits two levels above `src/db` and one level above the bundled `dist`. */
function findMigrationsFolder(): string {
  for (const relative of ['../../drizzle', '../drizzle']) {
    const candidate = fileURLToPath(new URL(relative, import.meta.url));
    if (existsSync(`${candidate}/meta/_journal.json`)) return candidate;
  }
  throw new Error('Could not locate the drizzle migrations folder');
}

export const MIGRATIONS_FOLDER = findMigrationsFolder();

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
