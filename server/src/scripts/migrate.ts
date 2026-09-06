import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { closePool, getPool } from "../db/pool";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");

async function main() {
  // Deliberately the shared pool rather than a private `new Pool(...)`: it is the single place
  // that decides TLS, and a managed database refuses an unencrypted connection outright
  // ("SSL/TLS required"). A script with its own pool silently misses that and fails only against
  // a real deployment - which is exactly how this was found.
  const pool = getPool();

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const { rows: appliedRows } = await pool.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations"
    );
    const applied = new Set(appliedRows.map((r) => r.filename));

    const pending = files.filter((f) => !applied.has(f));
    if (pending.length === 0) {
      console.log("No pending migrations. Database is up to date.");
      return;
    }

    for (const file of pending) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      console.log(`Applying migration: ${file}`);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }

    console.log(`Applied ${pending.length} migration(s).`);
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exitCode = 1;
});
