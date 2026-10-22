import { Logger } from '@nestjs/common';
import { Pool } from 'pg';

const logger = new Logger('DbPool');

// How long to wait for a pooled connection to be established.
const CONNECTION_TIMEOUT_MS = 5000;
// How long a single query may run before the client is torn down.
const QUERY_TIMEOUT_MS = 10000;

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      // A dead database must surface as an error, not as a request that never
      // returns: both waits are bounded. query_timeout is a client-side read
      // deadline; statement_timeout makes the server cancel the statement too.
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      query_timeout: QUERY_TIMEOUT_MS,
      statement_timeout: QUERY_TIMEOUT_MS,
    });

    // pg reports a server-side connection termination (database restart,
    // admin terminate) as an 'error' event on the pool. Node throws on
    // unhandled 'error' events, so without this listener a database blip
    // takes the whole service process down.
    pool.on('error', (error: Error) => {
      logger.error('Database pool error', error.stack ?? error.message);
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
