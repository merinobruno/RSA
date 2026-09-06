/**
 * Starts a PostgreSQL for local development and keeps it running until Ctrl+C.
 *
 *   npm run db:dev
 *
 * Unlike the throwaway instance `npm test` spins up, this one is PERSISTENT: its data lives in
 * `server/.pgdata` and survives restarts, so devices you register and telemetry you capture are
 * still there tomorrow. It uses the same `embedded-postgres` dependency (official PostgreSQL
 * binaries, no Docker and no admin rights) so there is nothing extra to install.
 *
 * It listens on the default port 5432 with the credentials from `.env.example`, so the
 * DATABASE_URL documented there works as-is.
 *
 * If you would rather use your own PostgreSQL (a real install, Docker, or a hosted one), ignore
 * this script entirely and just point DATABASE_URL at it -- nothing else depends on this.
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = Number(process.env.DEV_PG_PORT ?? 5432);
const DB_NAME = "rsa_telemetry";
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", ".pgdata");
const DATABASE_URL = `postgres://postgres:postgres@localhost:${PORT}/${DB_NAME}`;

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: true,
});

// `initialise()` bootstraps a fresh cluster and fails on an existing one, so it must run only the
// first time. The presence of the data directory is what distinguishes the two cases.
const firstRun = !existsSync(DATA_DIR);

let stopped = false;
async function stop(code) {
  if (stopped) return;
  stopped = true;
  console.log("\nstopping postgres...");
  try {
    await pg.stop();
    console.log("stopped cleanly. Your data is still in server/.pgdata");
  } catch (err) {
    console.error("failed to stop postgres cleanly:", err);
  }
  process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop(130));
}

try {
  if (firstRun) {
    console.log("first run: initialising a new database cluster in server/.pgdata ...");
    await pg.initialise();
  }
  await pg.start();

  if (firstRun) {
    await pg.createDatabase(DB_NAME);
    console.log(`created database "${DB_NAME}"`);
  }

  console.log("");
  console.log("=================================================================");
  console.log(" PostgreSQL is running. Leave this terminal open.");
  console.log("");
  console.log(` DATABASE_URL=${DATABASE_URL}`);
  console.log("");
  if (firstRun) {
    console.log(" First run - apply the schema in another terminal:");
    console.log("   npm run migrate");
    console.log("");
  }
  console.log(" Press Ctrl+C to stop.");
  console.log("=================================================================");

  // Park here; the signal handlers above own shutdown.
  await new Promise(() => {});
} catch (err) {
  console.error("\nfailed to start postgres:", err);
  console.error(
    `\nMost likely a previous run is still holding port ${PORT}. That happens when the process was\n` +
      "killed rather than stopped with Ctrl+C, which leaves the postgres server itself running.\n" +
      "Shut it down cleanly (this protects the data; do NOT kill it from Task Manager):\n\n" +
      `  node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe -D .pgdata -m fast stop\n\n` +
      `Otherwise, set DEV_PG_PORT to a free port and update DATABASE_URL to match.\n`
  );
  await stop(1);
}
