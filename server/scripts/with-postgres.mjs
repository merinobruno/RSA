/**
 * Runs a command with a PostgreSQL database guaranteed to be available.
 *
 *   node scripts/with-postgres.mjs vitest run
 *
 * If DATABASE_URL is already set (CI service container, Docker, a local install), the command runs
 * against that and nothing is started -- your database always wins. Otherwise a real PostgreSQL is
 * started from the `embedded-postgres` dev dependency (official PostgreSQL binaries, no Docker and
 * no admin rights), the command runs against it, and it is torn down afterwards.
 *
 * The point is that `npm test` runs the WHOLE suite everywhere, with no setup step. The integration
 * tests skip themselves when DATABASE_URL is missing, which is the right default for a library but
 * a trap for a project: the tests that touch real SQL are exactly the ones that rot unnoticed when
 * running them is opt-in.
 */
import EmbeddedPostgres from "embedded-postgres";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const command = process.argv.slice(2);
if (command.length === 0) {
  console.error("usage: node scripts/with-postgres.mjs <command> [args...]");
  process.exit(2);
}

const PORT = Number(process.env.EMBEDDED_PG_PORT ?? 55432);
const DB_NAME = "rsa_telemetry_test";
// Under node_modules so it is disposable and never lands in version control. `persistent: false`
// also removes it on shutdown; this is just belt and braces about *where* it lives.
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", ".cache", "embedded-pg");

function runCommand(databaseUrl) {
  return new Promise((resolve) => {
    const child = spawn(command.join(" "), {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "inherit",
      shell: true,
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", (err) => {
      console.error("failed to start command:", err);
      resolve(1);
    });
  });
}

if (process.env.DATABASE_URL) {
  console.log("DATABASE_URL is set; using it as-is and starting no embedded database.");
  process.exit(await runCommand(process.env.DATABASE_URL));
}

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: false,
});

let stopped = false;
async function stopPostgres() {
  if (stopped) return;
  stopped = true;
  try {
    await pg.stop();
  } catch (err) {
    console.error("failed to stop embedded postgres cleanly:", err);
  }
}

// Without this, interrupting a test run leaves an orphaned postgres process holding the port.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await stopPostgres();
    process.exit(130);
  });
}

let exitCode = 1;
try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB_NAME);
  exitCode = await runCommand(`postgres://postgres:postgres@127.0.0.1:${PORT}/${DB_NAME}`);
} catch (err) {
  console.error("\nembedded postgres failed to start:", err);
  console.error(
    `\nIf port ${PORT} is in use, set EMBEDDED_PG_PORT to a free one, or set DATABASE_URL to ` +
      "point at a database you are already running.\n"
  );
} finally {
  await stopPostgres();
}

process.exit(exitCode);
