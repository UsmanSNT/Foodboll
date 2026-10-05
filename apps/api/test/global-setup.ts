import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { createDb } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://foodboll:foodboll@localhost:5432/postgres';

/** Creates a throwaway database, migrates it, and drops it after the run. */
export default async function setup(project: TestProject) {
  const name = `foodboll_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      `Cannot reach PostgreSQL at TEST_DATABASE_ADMIN_URL (${ADMIN_URL}). ` +
        `Start one with "docker compose up -d db". ${String(error)}`,
    );
  }
  await admin.query(`create database ${name}`);

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const handle = createDb(url.toString(), { max: 1 });
  try {
    await runMigrations(handle.db);
  } finally {
    await handle.close();
  }
  project.provide('databaseUrl', url.toString());

  return async () => {
    await admin.query(`drop database ${name} with (force)`);
    await admin.end();
  };
}
