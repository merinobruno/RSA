/**
 * Brings up everything a field test needs, in order, with one command:
 *
 *   npm run stack
 *
 *   1. PostgreSQL          (persistent, server/.pgdata)
 *   2. the telemetry server (port 3000)
 *   3. a public HTTPS tunnel, and prints the URL to type into the phone
 *
 * Each step waits for the previous one to actually be reachable before starting, so you never end
 * up with a half-started stack that looks fine until the phone fails to connect from the road.
 *
 * Ctrl+C stops all three. The database keeps its data; the tunnel hostname does not survive - a
 * quick tunnel gets a fresh random hostname every run, which is why the URL is printed so
 * prominently. That is the one thing you must re-enter in the app before each session.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = join(HERE, "..");
const PORT = 3000;
const DATABASE_URL = "postgres://postgres:postgres@localhost:5432/rsa_telemetry";

const CLOUDFLARED_FALLBACK = "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe";

const children = [];
let shuttingDown = false;

/**
 * `command` is a full command line, not a command plus an args array: passing args separately
 * alongside `shell: true` is deprecated in Node (they get concatenated unescaped anyway).
 *
 * Output from a quiet child is still buffered in `child.recentOutput`, so a failure can show what
 * the process actually said instead of failing silently.
 */
function start(label, command, opts = {}) {
  const child = spawn(command, { stdio: ["ignore", "pipe", "pipe"], shell: true, ...opts });
  children.push({ label, child });
  child.recentOutput = [];
  const prefix = (line) => `[${label}] ${line}`;
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      for (const line of chunk.split("\n")) {
        if (!line.trim()) continue;
        child.recentOutput.push(line.trim());
        if (child.recentOutput.length > 40) child.recentOutput.shift();
        if (!opts.quiet) console.log(prefix(line.trim()));
      }
    });
  }
  child.on("exit", (code) => {
    if (!shuttingDown) console.log(prefix(`exited with code ${code}`));
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nstopping everything...");
  for (const { child } of children.reverse()) {
    try {
      // Kill the whole process TREE, not just the child we spawned. Each step here runs through a
      // shell (and `npm run dev` then spawns node), so killing only the direct child orphans the
      // grandchild -- which keeps holding port 3000 or 5432 and makes the NEXT run fail with
      // "port in use". On Windows only taskkill /T does this properly.
      if (process.platform === "win32" && child.pid) {
        spawn(`taskkill /pid ${child.pid} /T /F`, { shell: true, stdio: "ignore" });
      } else {
        child.kill();
      }
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(code), 2500);
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => shutdown(130));

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = net.connect(port, "127.0.0.1");
      socket.on("connect", () => {
        socket.end();
        resolve(true);
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() > deadline) return resolve(false);
        setTimeout(attempt, 1000);
      });
      socket.setTimeout(1500, () => {
        socket.destroy();
        if (Date.now() > deadline) return resolve(false);
        setTimeout(attempt, 1000);
      });
    };
    attempt();
  });
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function resolveCloudflared() {
  // A terminal opened before cloudflared was installed has a stale PATH, so fall back to the
  // known install location rather than failing with "command not found".
  return existsSync(CLOUDFLARED_FALLBACK) ? `"${CLOUDFLARED_FALLBACK}"` : "cloudflared";
}

console.log("1/3  starting PostgreSQL...");
const db = start("db", `node "${join(HERE, "dev-db.mjs")}"`, { cwd: SERVER_DIR, quiet: true });
if (!(await waitForPort(5432, 90000))) {
  console.error("\nPostgreSQL did not come up. What it said:\n");
  console.error(db.recentOutput.join("\n"));
  console.error("\n(Run `npm run db:dev` on its own to reproduce.)");
  shutdown(1);
} else {
  console.log("     PostgreSQL is accepting connections on 5432");

  console.log("2/3  starting the telemetry server...");
  const server = start("server", "npm run dev", {
    cwd: SERVER_DIR,
    env: { ...process.env, DATABASE_URL, PORT: String(PORT) },
    quiet: true,
  });
  if (!(await waitForHealth(60000))) {
    console.error("\nThe server never answered /health. What it said:\n");
    console.error(server.recentOutput.join("\n"));
    console.error("\n(Run `npm run dev` on its own to reproduce.)");
    shutdown(1);
  } else {
    console.log(`     server healthy on http://localhost:${PORT}`);

    console.log("3/3  opening the public HTTPS tunnel...");

    /**
     * One tunnel attempt: start cloudflared, wait for it to REGISTER (not merely to print the
     * hostname in its banner), then confirm the hostname actually resolves and answers.
     *
     * Both waits matter. cloudflared prints the URL well before the tunnel is live, and Cloudflare
     * sometimes hands out a quick-tunnel hostname it never publishes in DNS -- observed repeatedly
     * while building this. Checking too early is also actively harmful on the many ISPs that hijack
     * NXDOMAIN with a parking IP: the bad answer gets cached and the real hostname keeps failing
     * afterwards. So: register first, then resolve, then verify.
     */
    async function attemptTunnel() {
      const tunnel = start("tunnel", `${resolveCloudflared()} tunnel --url http://localhost:${PORT}`, { quiet: true });
      let url = null;
      let registered = false;
      const onData = (chunk) => {
        const match = chunk.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (match) url = match[0];
        if (/Registered tunnel connection/i.test(chunk)) registered = true;
      };
      tunnel.stdout.on("data", onData);
      tunnel.stderr.on("data", onData);

      const registerBy = Date.now() + 60000;
      while ((!url || !registered) && Date.now() < registerBy) await new Promise((r) => setTimeout(r, 500));
      if (!url || !registered) {
        return { tunnel, url, ok: false, why: url ? "never registered a connection" : "never reported a URL" };
      }

      for (let i = 0; i < 10; i++) {
        try {
          if ((await fetch(`${url}/health`)).ok) return { tunnel, url, ok: true };
        } catch {
          /* not resolvable yet */
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      return { tunnel, url, ok: false, why: "registered but its hostname never resolved (Cloudflare did not publish it)" };
    }

    let result = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      result = await attemptTunnel();
      if (result.ok) break;
      console.log(`     attempt ${attempt}/3: ${result.why}`);
      if (attempt < 3) {
        console.log("     retrying with a fresh hostname...");
        if (process.platform === "win32" && result.tunnel.pid) {
          spawn(`taskkill /pid ${result.tunnel.pid} /T /F`, { shell: true, stdio: "ignore" });
        } else {
          result.tunnel.kill();
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    const url = result?.url ?? null;
    if (!result?.ok) {
      console.error("\nCould not get a working tunnel after 3 attempts. What cloudflared said:\n");
      console.error(result?.tunnel?.recentOutput?.join("\n") ?? "(no output)");
      console.error(
        "\nThe database and server are still running fine on localhost - only the public URL failed.\n" +
          "Quick tunnels are best-effort; for anything you actually depend on, deploy the server instead.\n"
      );
    }
    console.log("\n==================================================================");
    if (result?.ok) {
      console.log(" READY - verified reachable from the public internet");
      console.log("");
      console.log("  Server URL for the app:");
      console.log(`      ${url}`);
      console.log("");
      console.log("  This hostname is NEW every run - update it in the app's Settings.");
      console.log("  Device ID and API key do NOT change; leave them as they are.");
    } else {
      console.log(" NOT READY - the phone will NOT be able to reach this machine");
      console.log("");
      console.log("  Database and server are up on localhost; only the public tunnel failed.");
      console.log("  Do not start a field test until this says READY.");
      console.log("");
      console.log("  Try again: Ctrl+C, then `npm run stack`. Each run gets a fresh hostname,");
      console.log("  and a hostname Cloudflare failed to publish is not retryable by waiting.");
    }
    console.log("");
    console.log("  Ctrl+C stops the tunnel, the server and the database.");
    console.log("==================================================================\n");

    await new Promise(() => {}); // park until Ctrl+C
  }
}
