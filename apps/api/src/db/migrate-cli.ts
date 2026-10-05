import { loadConfig } from '../config';
import { createDb } from './client';
import { runMigrations } from './migrate';

const config = loadConfig();
const handle = createDb(config.databaseUrl, { max: 1 });
try {
  await runMigrations(handle.db);
  console.log('Migrations applied.');
} finally {
  await handle.close();
}
