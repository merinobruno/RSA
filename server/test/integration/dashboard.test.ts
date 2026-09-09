import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";
import { Pool } from "pg";
import { createApp } from "../../src/app";
import { closePool, sslFor } from "../../src/db/pool";
import { config } from "../../src/config";

/**
 * The dashboard against a real database, with a stream shaped like the one that broke the first
 * design: a short trip, a long park, another trip, and a stretch that never moved at all.
 */
const DATABASE_URL = config.databaseUrl;

describe.skipIf(!DATABASE_URL)("flight dashboard (integration)", () => {
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let deviceId: string;
  let idleDeviceId: string;

  const MINUTE = 60 * 1000;
  const base = Date.parse("2026-05-01T12:00:00.000Z");

  async function insertRun(device: string, fromMinute: number, count: number, speedMps: number) {
    for (let i = 0; i < count; i++) {
      await pool.query(
        `INSERT INTO telemetry (device_id, packet_id, captured_at, lat, lon, altitude_m,
                                gps_accuracy_m, speed_mps, heading_deg, accel_x, accel_y, accel_z,
                                battery_pct)
         VALUES ($1, $2, $3, $4, $5, 300, 8, $6, 90, 0, 0, 0, 80)`,
        [
          device,
          randomUUID(),
          new Date(base + (fromMinute + i) * MINUTE).toISOString(),
          -38.93 + i * 0.001,
          -67.97,
          speedMps,
        ]
      );
    }
  }

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    // The schema is applied by test/globalSetup.ts, once for the whole run.
    pool = new Pool({ connectionString: DATABASE_URL, ssl: sslFor(DATABASE_URL) });

    deviceId = randomUUID();
    idleDeviceId = randomUUID();
    for (const [id, label] of [
      [deviceId, "Dashboard Test Aircraft"],
      [idleDeviceId, "Dashboard Test Parked"],
    ]) {
      await pool.query("INSERT INTO devices (id, label, api_key_hash) VALUES ($1, $2, $3)", [
        id,
        label,
        `hash-${id}`,
      ]);
    }

    // Trip, three hours parked, second trip.
    await insertRun(deviceId, 0, 15, 25);
    await insertRun(deviceId, 15, 180, 0);
    await insertRun(deviceId, 195, 20, 30);

    // A device that only ever sat still.
    await insertRun(idleDeviceId, 0, 60, 0);

    app = createApp();
  });

  afterAll(async () => {
    if (!DATABASE_URL) return;
    if (pool) {
      for (const id of [deviceId, idleDeviceId]) {
        await pool.query("DELETE FROM telemetry WHERE device_id = $1", [id]);
        await pool.query("DELETE FROM devices WHERE id = $1", [id]);
      }
      await pool.end();
    }
    await closePool();
  });

  function ourFlights(body: { flights: Array<{ device_id: string }> }) {
    return body.flights.filter((f) => f.device_id === deviceId || f.device_id === idleDeviceId);
  }

  describe("GET /api/flights", () => {
    it("splits one stream into the two trips either side of the park", async () => {
      const res = await request(app).get("/api/flights");

      expect(res.status).toBe(200);
      expect(ourFlights(res.body)).toHaveLength(2);
    });

    it("omits a device that never moved", async () => {
      const res = await request(app).get("/api/flights");

      expect(res.body.flights.some((f: { device_id: string }) => f.device_id === idleDeviceId))
        .toBe(false);
    });

    it("returns flights newest first", async () => {
      const res = await request(app).get("/api/flights");
      const times = ourFlights(res.body).map((f: never & { started_at: string }) =>
        Date.parse(f.started_at)
      );

      expect(times[0]).toBeGreaterThan(times[1]);
    });
  });

  describe("GET /", () => {
    it("renders the index as a logbook of ruled rows", async () => {
      const res = await request(app).get("/");

      expect(res.status).toBe(200);
      expect(res.text).toContain('class="rows-head"');
      expect(res.text).toContain('class="entry"');
      expect(res.text).toContain("glyph-line");
    });

    it("lists every registered device, including the one that never flew", async () => {
      // The parked device produces no flight at all, so a flights-only page would hide it. That is
      // the exact shape of this project's one unfixable risk: a killed service reports nothing.
      const res = await request(app).get("/");

      expect(res.text).toContain("Dashboard Test Aircraft");
      expect(res.text).toContain("Dashboard Test Parked");
    });

    it("measures each flight's distance from real rows", async () => {
      // The fixture walks 0.001 degrees of latitude per packet, so a 15-packet run is well over a
      // kilometre and cannot pass by rendering a zero.
      const res = await request(app).get("/api/flights");
      const ours = ourFlights(res.body) as Array<never & { distance_m: number }>;

      expect(ours).not.toHaveLength(0);
      for (const flight of ours) expect(flight.distance_m).toBeGreaterThan(1000);
    });
  });

  describe("GET /flights/:deviceId/:at", () => {
    it("renders a map page for a real flight", async () => {
      const list = await request(app).get("/api/flights");
      const flight = ourFlights(list.body)[0] as never & { started_at: string };
      const at = Date.parse(flight.started_at);

      const res = await request(app).get(`/flights/${deviceId}/${at}`);

      expect(res.status).toBe(200);
      expect(res.text).toContain('id="map"');
      expect(res.text).toContain("leaflet");
    });

    it("says plainly that the altitude cannot be trusted", async () => {
      // The number is on screen; the caveat has to be too, or the page quietly lends it authority.
      const list = await request(app).get("/api/flights");
      const flight = ourFlights(list.body)[0] as never & { started_at: string };

      const res = await request(app).get(`/flights/${deviceId}/${Date.parse(flight.started_at)}`);

      expect(res.text).toContain("altitud");
      expect(res.text).toContain("no es confiable");
    });

    it("draws the elevation profile from real rows", async () => {
      const list = await request(app).get("/api/flights");
      const flight = ourFlights(list.body)[0] as never & { started_at: string };

      const res = await request(app).get(`/flights/${deviceId}/${Date.parse(flight.started_at)}`);

      expect(res.text).toContain('class="profile-svg"');
      expect(res.text).toContain('class="profile-envelope"');
    });

    it("shades a fixture whose elevation never moves as entirely frozen", async () => {
      // Every row in this fixture carries altitude_m = 300, which is the stuck-value signature the
      // warning describes. If the shading does not appear here, it will not appear anywhere.
      const list = await request(app).get("/api/flights");
      const flight = ourFlights(list.body)[0] as never & { started_at: string };

      const res = await request(app).get(`/flights/${deviceId}/${Date.parse(flight.started_at)}`);

      expect(res.text).toContain('fill-opacity="0.550"');
    });

    it("reads the whole page in aviation units", async () => {
      const list = await request(app).get("/api/flights");
      const flight = ourFlights(list.body)[0] as never & { started_at: string };

      const res = await request(app).get(`/flights/${deviceId}/${Date.parse(flight.started_at)}`);

      expect(res.text).toContain("NM");
      expect(res.text).toContain("kt");
      expect(res.text).toContain("ELEV GPS");
    });

    it("shows times on a 24-hour clock", async () => {
      // es-AR defaults to 12-hour and rendered 19:16 as "07:16 p. m.", which is ambiguous and not
      // how a flight time is ever stated.
      const list = await request(app).get("/api/flights");
      const flight = ourFlights(list.body)[0] as never & { started_at: string };

      const res = await request(app).get(`/flights/${deviceId}/${Date.parse(flight.started_at)}`);

      expect(res.text).not.toContain("p. m.");
      expect(res.text).not.toContain("a. m.");
    });

    it("404s for an instant that falls in the parked gap", async () => {
      const res = await request(app).get(`/flights/${deviceId}/${base + 100 * MINUTE}`);

      expect(res.status).toBe(404);
    });

    it("404s for a non-numeric instant instead of reaching the database", async () => {
      const res = await request(app).get(`/flights/${deviceId}/not-a-number`);

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/flights/:deviceId/:at/track", () => {
    it("returns only the points of that flight", async () => {
      const list = await request(app).get("/api/flights");
      const flights = ourFlights(list.body) as Array<never & { started_at: string; packet_count: number }>;
      const flight = flights[0];

      const res = await request(app).get(
        `/api/flights/${deviceId}/${Date.parse(flight.started_at)}/track`
      );

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(flight.packet_count);
      expect(res.body.track[0]).toHaveProperty("lat");
    });
  });

  it("sends the flight page compressed", async () => {
    // The track is inlined in the page, and at 1 Hz a real flight is a few hundred kilobytes of
    // coordinates. Over mobile data that is the difference between a page that opens and one that
    // does not, so this is part of the contract rather than a deployment detail.
    const list = await request(app).get("/api/flights");
    const flight = ourFlights(list.body)[0] as never & { started_at: string };

    const res = await request(app)
      .get(`/flights/${deviceId}/${Date.parse(flight.started_at)}`)
      .set("Accept-Encoding", "gzip");

    expect(res.headers["content-encoding"]).toBe("gzip");
  });

  it("asks search engines to stay away", async () => {
    const res = await request(app).get("/robots.txt");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Disallow: /");
  });
});
