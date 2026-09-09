import { Router } from "express";
import { findFlight, findTrack, listDeviceStatus, listFlights } from "../db/flightRepository";
import { flightDetailPage, flightListPage } from "../views/flightPages";

/**
 * The public, read-only dashboard.
 *
 * Deliberately unauthenticated: the operator chose a public URL knowingly, having been shown that
 * the tracks reveal where they live and include a third party's movements.
 *
 * These routes read the database directly rather than calling the device API. That API
 * authenticates with a device's own key and refuses any other device's telemetry - correct for
 * devices, useless for a dashboard that must show several. Reading server-side keeps the device
 * API untouched and means no second credential type had to exist.
 *
 * Nothing here writes. A public surface that can only read is a much smaller thing to reason about
 * than one that cannot.
 */
export const dashboardRouter = Router();

/**
 * The index with nothing in it, which is what a bad flight link gets.
 *
 * Answering a dead link with the empty index rather than a bare 404 body keeps the reader on a page
 * with a way back, and it costs no query.
 */
function emptyIndex(): string {
  return flightListPage({ flights: [], devices: [], nowMillis: Date.now() });
}

/** Rejects a path segment that is not a positive integer of milliseconds. */
function parseInstant(raw: string): Date | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const millis = Number(raw);
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date;
}

dashboardRouter.get("/", async (_req, res, next) => {
  try {
    // Both reads in parallel: neither depends on the other, and the index is the page most likely
    // to be the one paying a free-tier cold start.
    const [flights, devices] = await Promise.all([listFlights(), listDeviceStatus()]);
    res.type("html").send(flightListPage({ flights, devices, nowMillis: Date.now() }));
  } catch (err) {
    next(err);
  }
});

dashboardRouter.get("/flights/:deviceId/:at", async (req, res, next) => {
  try {
    const instant = parseInstant(req.params.at);
    if (!instant) {
      res.status(404).type("html").send(emptyIndex());
      return;
    }

    const flight = await findFlight(req.params.deviceId, instant);
    if (!flight) {
      res.status(404).type("html").send(emptyIndex());
      return;
    }

    const points = await findTrack(flight.deviceId, flight.startedAt, flight.endedAt);
    res.type("html").send(flightDetailPage(flight, points));
  } catch (err) {
    next(err);
  }
});

dashboardRouter.get("/api/flights", async (_req, res, next) => {
  try {
    const flights = await listFlights();
    res.json({
      count: flights.length,
      flights: flights.map((f) => ({
        device_id: f.deviceId,
        device_label: f.deviceLabel,
        started_at: f.startedAt.toISOString(),
        ended_at: f.endedAt.toISOString(),
        packet_count: f.packetCount,
        max_speed_mps: f.maxSpeedMps,
        distance_m: f.distanceM,
      })),
    });
  } catch (err) {
    next(err);
  }
});

dashboardRouter.get("/api/flights/:deviceId/:at/track", async (req, res, next) => {
  try {
    const instant = parseInstant(req.params.at);
    if (!instant) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const flight = await findFlight(req.params.deviceId, instant);
    if (!flight) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const points = await findTrack(flight.deviceId, flight.startedAt, flight.endedAt);
    res.json({
      device_id: flight.deviceId,
      device_label: flight.deviceLabel,
      started_at: flight.startedAt.toISOString(),
      ended_at: flight.endedAt.toISOString(),
      count: points.length,
      track: points.map((p) => ({
        captured_at: p.capturedAt.toISOString(),
        lat: p.lat,
        lon: p.lon,
        altitude_m: p.altitudeM,
        gps_accuracy_m: p.gpsAccuracyM,
        speed_mps: p.speedMps,
        heading_deg: p.headingDeg,
        battery_pct: p.batteryPct,
      })),
    });
  } catch (err) {
    next(err);
  }
});

dashboardRouter.get("/robots.txt", (_req, res) => {
  // Not access control. The URL is public by decision; this only keeps the tracks from being
  // found by someone who was never given the link.
  res.type("text/plain").send("User-agent: *\nDisallow: /\n");
});
