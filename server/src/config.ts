import "dotenv/config";

/**
 * Centralized runtime configuration.
 *
 * Note: `databaseUrl` is intentionally NOT validated here. Validation happens
 * lazily in `src/db/pool.ts` the first time a database connection is needed,
 * so that modules which don't touch the database (e.g. the Zod schema and
 * pure service functions) can be imported and unit-tested without requiring
 * a `DATABASE_URL` to be set.
 */
export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL,
  telemetry: {
    // Defaults/limits for GET /v1/devices/:id/telemetry pagination.
    defaultLimit: 100,
    maxLimit: 1000,
  },
} as const;
