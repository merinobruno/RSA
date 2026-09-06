import { Pool } from "pg";
import { config } from "../config";

let pool: Pool | undefined;

/**
 * Lazily creates (once) and returns the shared connection pool.
 * Throws only when actually invoked, so importing this module does not
 * require `DATABASE_URL` to be set (useful for pure unit tests).
 */
export function getPool(): Pool {
  if (!pool) {
    if (!config.databaseUrl) {
      throw new Error(
        "Missing required environment variable: DATABASE_URL. " +
          "Set it in your environment or in a .env file (see .env.example)."
      );
    }
    pool = new Pool({ connectionString: config.databaseUrl });
  }
  return pool;
}

/** Closes the shared pool, if one was created. Used by tests and graceful shutdown. */
export async function closePool(): Promise<void> {
  if (pool) {
    const toClose = pool;
    pool = undefined;
    await toClose.end();
  }
}
