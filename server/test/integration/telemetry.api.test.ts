import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { Pool } from "pg";
import { createApp } from "../../src/app";
import { hashApiKey } from "../../src/middleware/auth";
import { closePool, sslFor } from "../../src/db/pool";
import { config } from "../../src/config";

/**
 * Integration test against a REAL Postgres database.
 *
 * Requires a `DATABASE_URL` environment variable pointing at a reachable
 * Postgres instance (an empty/disposable database is fine - this suite
 * applies the migrations itself and cleans up its own rows afterwards).
 * See README.md ("Running the integration tests") for how to start one,
 * e.g.:
 *
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
 *
 * If DATABASE_URL is not set, this entire suite is SKIPPED (not failed) so
 * that `npm test` still runs the pure unit tests in any environment.
 */
// Read through `config`, NOT `process.env` directly. `config` imports "dotenv/config", so it sees
// a DATABASE_URL coming from a .env file; reading process.env here would not, and the two views
// disagreeing is what previously made this suite skip its tests while still trying to connect.
const DATABASE_URL = config.databaseUrl;

if (!DATABASE_URL) {
  console.warn(
    "\n[integration tests] DATABASE_URL is not set - skipping telemetry.api.test.ts.\n" +
      "See README.md for how to start a disposable Postgres instance for these tests.\n"
  );
}

describe.skipIf(!DATABASE_URL)(
  "POST /v1/telemetry and GET /v1/devices/:id/telemetry (integration)",
  () => {
    let setupPool: Pool;
    let app: ReturnType<typeof createApp>;
    let deviceId: string;
    let apiKey: string;

    beforeAll(async () => {
      // `describe.skipIf` skips the TESTS but still runs this hook, and
      // `new Pool({ connectionString: undefined })` makes pg fall back to its own default of
      // localhost:5432 - so without this guard the suite fails with ECONNREFUSED on any machine
      // that has no Postgres there, which is exactly the `npm run test:unit` fast loop.
      // Belt and braces: the suite is already skipped when there is no DATABASE_URL, but without
      // this guard `new Pool({ connectionString: undefined })` would silently fall back to pg's
      // own localhost:5432 default and fail with a confusing ECONNREFUSED instead of a clear skip.
      if (!DATABASE_URL) return;

      // Same TLS decision the app itself makes, so pointing this suite at a managed database
      // works rather than failing with "SSL/TLS required".
      setupPool = new Pool({ connectionString: DATABASE_URL, ssl: sslFor(DATABASE_URL) });

      // Apply migrations so the test database has the expected schema.
      // Safe to re-run: every statement uses IF NOT EXISTS.
      const migrationsDir = join(__dirname, "..", "..", "migrations");
      const files = readdirSync(migrationsDir)
        .filter((f) => f.endsWith(".sql"))
        .sort();
      for (const file of files) {
        const sql = readFileSync(join(migrationsDir, file), "utf8");
        await setupPool.query(sql);
      }

      app = createApp();

      deviceId = randomUUID();
      apiKey = `test-api-key-${randomUUID()}`;
      await setupPool.query("INSERT INTO devices (id, label, api_key_hash) VALUES ($1, $2, $3)", [
        deviceId,
        "Integration Test Aircraft",
        hashApiKey(apiKey),
      ]);
    });

    afterAll(async () => {
      if (!DATABASE_URL) return;

      if (setupPool) {
        await setupPool.query("DELETE FROM telemetry WHERE device_id = $1", [deviceId]);
        await setupPool.query("DELETE FROM devices WHERE id = $1", [deviceId]);
        await setupPool.end();
      }
      // The app under test lazily creates its own pool (src/db/pool.ts);
      // close it too so the test process can exit cleanly.
      await closePool();
    });

    function makePacket(overrides: Record<string, unknown> = {}) {
      return {
        packet_id: randomUUID(),
        device_id: deviceId,
        captured_at: new Date().toISOString(),
        lat: -34.6037,
        lon: -58.3816,
        altitude_m: 1200.5,
        gps_accuracy_m: 8.2,
        speed_mps: 42.3,
        heading_deg: 187.4,
        acceleration: { x: 0.12, y: -0.03, z: 9.81 },
        battery_pct: 76,
        ...overrides,
      };
    }

    describe("auth", () => {
      it("rejects requests with no Authorization header (401)", async () => {
        const res = await request(app).post("/v1/telemetry").send([makePacket()]);
        expect(res.status).toBe(401);
      });

      it("rejects requests with an invalid API key (401)", async () => {
        const res = await request(app)
          .post("/v1/telemetry")
          .set("Authorization", "Bearer not-a-real-key")
          .send([makePacket()]);
        expect(res.status).toBe(401);
      });
    });

    describe("malformed requests", () => {
      it("rejects a malformed JSON body with 400", async () => {
        const res = await request(app)
          .post("/v1/telemetry")
          .set("Authorization", `Bearer ${apiKey}`)
          .set("Content-Type", "application/json")
          .send("{ this is not valid json");
        expect(res.status).toBe(400);
      });

      it("rejects a non-array body with 400", async () => {
        const res = await request(app)
          .post("/v1/telemetry")
          .set("Authorization", `Bearer ${apiKey}`)
          .send({ not: "an array" });
        expect(res.status).toBe(400);
      });
    });

    describe("ingest", () => {
      it("accepts a batch of valid packets and inserts all of them", async () => {
        const packets = [makePacket(), makePacket(), makePacket()];
        const res = await request(app)
          .post("/v1/telemetry")
          .set("Authorization", `Bearer ${apiKey}`)
          .send(packets);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          received: 3,
          accepted: 3,
          inserted: 3,
          duplicates: 0,
          rejected: 0,
          rejected_packets: [],
        });
      });

      it("is idempotent: resending the same packet_id does not duplicate or error", async () => {
        const packet = makePacket();

        const first = await request(app)
          .post("/v1/telemetry")
          .set("Authorization", `Bearer ${apiKey}`)
          .send([packet]);
        expect(first.status).toBe(200);
        expect(first.body.inserted).toBe(1);

        const second = await request(app)
          .post("/v1/telemetry")
          .set("Authorization", `Bearer ${apiKey}`)
          .send([packet]); // exact same packet_id, simulating a client retry
        expect(second.status).toBe(200);
        expect(second.body.accepted).toBe(1);
        expect(second.body.inserted).toBe(0);
        expect(second.body.duplicates).toBe(1);
        expect(second.body.rejected).toBe(0);

        const { rows } = await setupPool.query(
          "SELECT count(*)::int AS count FROM telemetry WHERE device_id = $1 AND packet_id = $2",
          [deviceId, packet.packet_id]
        );
        expect(rows[0].count).toBe(1);
      });

      it("deduplicates a repeated packet_id within a single batch too", async () => {
        const packet = makePacket();
        const res = await request(app)
          .post("/v1/telemetry")
          .set("Authorization", `Bearer ${apiKey}`)
          .send([packet, packet, packet]);

        expect(res.status).toBe(200);
        expect(res.body.received).toBe(3);
        expect(res.body.accepted).toBe(3);
        expect(res.body.inserted).toBe(1);
        expect(res.body.duplicates).toBe(2);

        const { rows } = await setupPool.query(
          "SELECT count(*)::int AS count FROM telemetry WHERE device_id = $1 AND packet_id = $2",
          [deviceId, packet.packet_id]
        );
        expect(rows[0].count).toBe(1);
      });

      it("accepts valid packets and reports rejected ones with reasons, within the same batch", async () => {
        const goodPacket = makePacket();
        const badPacket = makePacket({ lat: 999 });

        const res = await request(app)
          .post("/v1/telemetry")
          .set("Authorization", `Bearer ${apiKey}`)
          .send([goodPacket, badPacket]);

        expect(res.status).toBe(200);
        expect(res.body.accepted).toBe(1);
        expect(res.body.inserted).toBe(1);
        expect(res.body.rejected).toBe(1);
        expect(res.body.rejected_packets).toHaveLength(1);
        expect(res.body.rejected_packets[0].packet_id).toBe(badPacket.packet_id);
        expect(res.body.rejected_packets[0].reason).toMatch(/lat/);

        const { rows } = await setupPool.query(
          "SELECT packet_id FROM telemetry WHERE device_id = $1 AND packet_id = $2",
          [deviceId, goodPacket.packet_id]
        );
        expect(rows).toHaveLength(1);
      });

      it("rejects a packet whose body device_id does not match the authenticated device", async () => {
        const packet = makePacket({ device_id: randomUUID() });
        const res = await request(app)
          .post("/v1/telemetry")
          .set("Authorization", `Bearer ${apiKey}`)
          .send([packet]);

        expect(res.status).toBe(200);
        expect(res.body.rejected).toBe(1);
        expect(res.body.rejected_packets[0].reason).toMatch(/does not match/);
      });
    });

    describe("GET /v1/devices/:id/telemetry", () => {
      it("returns inserted telemetry ordered by captured_at ascending", async () => {
        const base = Date.parse("2026-01-01T00:00:00.000Z");
        const packets = [0, 1, 2].map((i) =>
          makePacket({ captured_at: new Date(base + i * 60_000).toISOString() })
        );
        // Insert out of chronological order to prove ORDER BY captured_at works.
        await request(app)
          .post("/v1/telemetry")
          .set("Authorization", `Bearer ${apiKey}`)
          .send([packets[2], packets[0], packets[1]]);

        const res = await request(app)
          .get(`/v1/devices/${deviceId}/telemetry`)
          .set("Authorization", `Bearer ${apiKey}`)
          .query({ since: new Date(base).toISOString(), limit: 10 });

        expect(res.status).toBe(200);
        const returnedIds = (res.body.telemetry as Array<{ packet_id: string }>)
          .filter((t) => packets.some((p) => p.packet_id === t.packet_id))
          .map((t) => t.packet_id);
        expect(returnedIds).toEqual([
          packets[0].packet_id,
          packets[1].packet_id,
          packets[2].packet_id,
        ]);
      });

      it("round-trips every field to the correct column, not just the packet_id", async () => {
        // Guards the bulk `unnest` INSERT specifically. That query passes each field as its own
        // array, so a misalignment between the arrays, the column list and the alias list would
        // store values under the wrong columns while still inserting "successfully" -- the row
        // count and the packet_id would look perfectly fine. Only comparing every value back out
        // catches it. Deliberately distinct, asymmetric values: with 9.81-style repeats or
        // symmetric numbers, a swap between two columns would still compare equal.
        const packet = makePacket({
          captured_at: "2026-03-04T05:06:07.000Z",
          lat: -34.61,
          lon: -58.38,
          altitude_m: -47.3,
          gps_accuracy_m: 3.25,
          speed_mps: 61.75,
          heading_deg: 271.5,
          acceleration: { x: 1.5, y: -2.25, z: 8.125 },
          battery_pct: 43,
        });

        await request(app)
          .post("/v1/telemetry")
          .set("Authorization", `Bearer ${apiKey}`)
          .send([packet]);

        const res = await request(app)
          .get(`/v1/devices/${deviceId}/telemetry`)
          .set("Authorization", `Bearer ${apiKey}`)
          .query({ since: "2026-03-04T05:06:07.000Z", limit: 1 });

        expect(res.status).toBe(200);
        const stored = (res.body.telemetry as Array<Record<string, unknown>>).find(
          (t) => t.packet_id === packet.packet_id
        );
        expect(stored).toBeDefined();
        expect(stored).toMatchObject({
          packet_id: packet.packet_id,
          captured_at: packet.captured_at,
          lat: packet.lat,
          lon: packet.lon,
          altitude_m: packet.altitude_m,
          gps_accuracy_m: packet.gps_accuracy_m,
          speed_mps: packet.speed_mps,
          heading_deg: packet.heading_deg,
          acceleration: packet.acceleration,
          battery_pct: packet.battery_pct,
        });
      });

      it("filters out telemetry captured before 'since'", async () => {
        const res = await request(app)
          .get(`/v1/devices/${deviceId}/telemetry`)
          .set("Authorization", `Bearer ${apiKey}`)
          .query({ since: "2099-01-01T00:00:00.000Z" });

        expect(res.status).toBe(200);
        expect(res.body.telemetry).toEqual([]);
      });

      it("respects the limit parameter", async () => {
        await request(app)
          .post("/v1/telemetry")
          .set("Authorization", `Bearer ${apiKey}`)
          .send([makePacket(), makePacket(), makePacket()]);

        const res = await request(app)
          .get(`/v1/devices/${deviceId}/telemetry`)
          .set("Authorization", `Bearer ${apiKey}`)
          .query({ limit: 1 });

        expect(res.status).toBe(200);
        expect(res.body.telemetry).toHaveLength(1);
      });

      it("rejects reading another device's telemetry with 403", async () => {
        const res = await request(app)
          .get(`/v1/devices/${randomUUID()}/telemetry`)
          .set("Authorization", `Bearer ${apiKey}`);
        expect(res.status).toBe(403);
      });

      it("rejects an invalid 'since' parameter with 400", async () => {
        const res = await request(app)
          .get(`/v1/devices/${deviceId}/telemetry`)
          .set("Authorization", `Bearer ${apiKey}`)
          .query({ since: "not-a-date" });
        expect(res.status).toBe(400);
      });

      it("rejects requests with no Authorization header (401)", async () => {
        const res = await request(app).get(`/v1/devices/${deviceId}/telemetry`);
        expect(res.status).toBe(401);
      });
    });
  }
);
