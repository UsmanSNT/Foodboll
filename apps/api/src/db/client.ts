import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

/** A transaction handle; same query API as `Db`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export interface DbHandle {
  readonly db: Db;
  readonly pool: pg.Pool;
  close(): Promise<void>;
}

export interface DbOptions {
  readonly max?: number;
  /** Called for connection-level errors (server restart, dropped socket). Defaults to stderr. */
  readonly onError?: (error: Error) => void;
}

export function createDb(connectionString: string, options: DbOptions = {}): DbHandle {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Fail fast instead of piling up behind a stuck query.
    statement_timeout: 15_000,
  });
  const report =
    options.onError ??
    ((error: Error) => process.stderr.write(`database connection error: ${error.message}\n`));
  // An 'error' event without a listener crashes the process. Idle clients emit on the pool; a
  // checked-out client (e.g. an open transaction) emits on itself, so both need a listener. The
  // query that was running still rejects normally, and pg-pool discards the dead client.
  pool.on('error', report);
  pool.on('connect', (client) => client.on('error', report));
  return { db: drizzle(pool, { schema }), pool, close: () => pool.end() };
}

export { schema };
