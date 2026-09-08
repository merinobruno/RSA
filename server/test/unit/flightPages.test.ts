import { describe, expect, it } from "vitest";
import { flightDetailPage, flightListPage } from "../../src/views/flightPages";
import { SPEED_BAND_COUNT } from "../../src/services/trackBanding";
import type { FlightSummary, TrackPoint } from "../../src/db/flightRepository";

const SECOND = 1000;
const BASE = Date.parse("2026-09-07T22:16:00.000Z");

/** A track captured at 1 Hz, which is what the app now records. */
function track(count: number, speedAt: (i: number) => number = () => 30): TrackPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    capturedAt: new Date(BASE + i * SECOND),
    lat: -38.93 + i * 0.0001,
    lon: -67.97 + i * 0.0001,
    altitudeM: 300,
    gpsAccuracyM: 8,
    speedMps: speedAt(i),
    headingDeg: 187,
    batteryPct: 80,
  }));
}

function summaryFor(points: TrackPoint[]): FlightSummary {
  return {
    deviceId: "9f1c8a2e-0000-4000-8000-000000000001",
    deviceLabel: "Celular principal",
    startedAt: points[0].capturedAt,
    endedAt: points[points.length - 1].capturedAt,
    packetCount: points.length,
    maxSpeedMps: Math.max(...points.map((p) => p.speedMps)),
  };
}

/** The single JSON payload the detail page hands to its client script. */
function payloadOf(html: string): {
  startedAt: number;
  points: Array<[number, number, number, number, number]>;
  bands: Array<{ band: number; hue: number; ranges: Array<[number, number]> }>;
} {
  const match = /var flight = (\{.*?\});/s.exec(html);
  if (!match) throw new Error("The page embeds no flight payload.");
  return JSON.parse(match[1]);
}

describe("flightDetailPage", () => {
  it("draws a long flight as a handful of bands, not one layer per point", () => {
    // A 40 minute flight at 1 Hz. The page used to emit one Leaflet layer per pair of points.
    const points = track(2400, (i) => (i % 200) * 0.5);

    const payload = payloadOf(flightDetailPage(summaryFor(points), points));

    expect(payload.points).toHaveLength(2400);
    expect(payload.bands.length).toBeLessThanOrEqual(SPEED_BAND_COUNT);
  });

  it("covers every drawn segment with exactly one band", () => {
    const points = track(500, (i) => i * 0.1);

    const { bands } = payloadOf(flightDetailPage(summaryFor(points), points));
    const covered = bands.reduce(
      (total, b) => total + b.ranges.reduce((n, [from, to]) => n + (to - from), 0),
      0
    );

    expect(covered).toBe(499);
  });

  it("gives each band a hue from the slow end of the ramp to the fast end", () => {
    const points = track(200, (i) => i * 0.5);

    const { bands } = payloadOf(flightDetailPage(summaryFor(points), points));
    const hues = bands.map((b) => b.hue);

    // Slow is blue, fast is red: the hue has to fall as the band rises.
    expect(hues).toEqual([...hues].sort((a, b) => b - a));
    expect(Math.max(...hues)).toBeLessThanOrEqual(210);
    expect(Math.min(...hues)).toBeGreaterThanOrEqual(0);
  });

  it("carries a capture time for every point so the readout can state one", () => {
    const points = track(120);

    const payload = payloadOf(flightDetailPage(summaryFor(points), points));

    // Offsets are seconds from the flight's start; they have to reconstruct the real instants, or
    // the readout confidently reports the wrong time.
    const reconstructed = payload.points.map((p) => payload.startedAt + p[3] * 1000);
    expect(reconstructed).toEqual(points.map((p) => p.capturedAt.getTime()));
  });

  it("carries speed and heading for every point", () => {
    const points = track(3, (i) => 10 + i);

    const payload = payloadOf(flightDetailPage(summaryFor(points), points));

    expect(payload.points.map((p) => p[2])).toEqual([10, 11, 12]);
    expect(payload.points.map((p) => p[4])).toEqual([187, 187, 187]);
  });

  it("rounds coordinates to the precision the map can use", () => {
    const points = track(2);
    points[0].lat = -38.9312345678;

    const payload = payloadOf(flightDetailPage(summaryFor(points), points));

    expect(payload.points[0][0]).toBe(-38.931235);
  });

  it("offers a readout the reader can drive without a mouse", () => {
    // Hover alone leaves the track unreadable on a phone and unreachable from a keyboard.
    const points = track(50);

    const html = flightDetailPage(summaryFor(points), points);

    expect(html).toContain('id="readout"');
    expect(html).toContain('type="range"');
  });

  it("links back to the flight list with an affordance of its own", () => {
    // The header title has always pointed at "/", but it is white, unstyled and reads as a title
    // rather than as a way back. The exit has to be something the reader can see is an exit.
    const points = track(10);

    const html = flightDetailPage(summaryFor(points), points);

    expect(html).toMatch(/<a class="back" href="\/">[^<]*\S/);
  });

  it("still says plainly that the altitude cannot be trusted", () => {
    const points = track(10);

    const html = flightDetailPage(summaryFor(points), points);

    expect(html).toContain("no es confiable");
    expect(html).not.toContain("altitude_m");
  });

  it("still states every time on a 24-hour clock", () => {
    const points = track(10);

    const html = flightDetailPage(summaryFor(points), points);

    expect(html).not.toContain("p. m.");
    expect(html).not.toContain("a. m.");
  });

  it("escapes a device label instead of trusting it", () => {
    const points = track(5);
    const flight = { ...summaryFor(points), deviceLabel: '<img src=x onerror="alert(1)">' };

    const html = flightDetailPage(flight, points);

    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("renders a flight with a single point without embedding a broken band", () => {
    const points = track(1);

    const payload = payloadOf(flightDetailPage(summaryFor(points), points));

    expect(payload.points).toHaveLength(1);
    expect(payload.bands).toEqual([]);
  });
});

describe("flightListPage", () => {
  it("does not offer a back link on the page it would return to", () => {
    const points = track(5);

    const html = flightListPage([summaryFor(points)]);

    expect(html).not.toContain("Volver");
  });

  it("teaches the reader what to do when there are no flights yet", () => {
    const html = flightListPage([]);

    expect(html).toContain("Todavía no hay vuelos");
  });
});
