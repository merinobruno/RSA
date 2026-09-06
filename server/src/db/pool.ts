import { Pool } from "pg";
import { config } from "../config";

let pool: Pool | undefined;

/** Hosts that mean "the database is on this machine", where TLS is neither used nor available. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Decides the TLS settings for a connection string.
 *
 * The two environments this server runs in want opposite things. The local development cluster
 * (`npm run db:dev`) speaks no TLS at all, so requiring it fails outright. Every managed provider
 * (Render, Railway, Neon, Supabase, Heroku) requires TLS, and most present a certificate signed by
 * a CA that is not in Node's default trust store, so *verifying* it fails outright too.
 *
 * Hence: off for a local host, encrypted-but-unverified for anything else. That default is what
 * makes a hosted deployment work with no configuration. `DATABASE_SSL` overrides it:
 *
 *   "off"     - no TLS
 *   "require" - TLS, certificate not verified (the remote default)
 *   "strict"  - TLS with full verification; use it when your provider's CA is trusted, since it is
 *               the only one of the three that actually protects against a man-in-the-middle
 */
export function sslFor(
  databaseUrl: string,
  rawMode: string | undefined = config.databaseSsl
): false | { rejectUnauthorized: boolean } {
  const mode = rawMode?.trim().toLowerCase();
  if (mode === "off") return false;
  if (mode === "require") return { rejectUnauthorized: false };
  if (mode === "strict") return { rejectUnauthorized: true };
  if (mode) {
    throw new Error(`Invalid DATABASE_SSL value "${rawMode}". Use "off", "require" or "strict".`);
  }

  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    // Not a parseable URL (a libpq key=value string, say). Assume remote: requiring TLS on a
    // connection that turns out to be local fails loudly, while silently skipping TLS on one that
    // is actually remote would send credentials in the clear.
    return { rejectUnauthorized: false };
  }
  return LOCAL_HOSTS.has(host) ? false : { rejectUnauthorized: false };
}

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
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: sslFor(config.databaseUrl),
    });
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
