import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { Pool } from "pg";
import { sslFor } from "../src/db/pool";
import { config } from "../src/config";

/**
 * Applies the schema once, before any test file runs.
 *
 * It used to happen in each integration suite's `beforeAll`, which worked until there were two of
 * them: vitest runs files in parallel, and two concurrent `CREATE TABLE IF NOT EXISTS` statements
 * race - the existence check is not atomic against another transaction creating the same type, and
 * Postgres fails one of them with a duplicate key on `pg_type_typname_nsp_index`.
 *
 * Serialising the whole suite would also have fixed it, and would have made every test slower to
 * work around something that is not a test concern at all. Preparing the database is environment
 * setup; it belongs here, once, not in each suite that happens to need it.
 */
export default async function setup() {
  if (!config.databaseUrl) return;

  const pool = new Pool({ connectionString: config.databaseUrl, ssl: sslFor(config.databaseUrl) });
  try {
    const migrationsDir = join(__dirname, "..", "migrations");
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      await pool.query(readFileSync(join(migrationsDir, file), "utf8"));
    }
  } finally {
    await pool.end();
  }
}
