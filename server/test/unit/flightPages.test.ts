import { describe, expect, it } from "vitest";
import {
  flightDetailPage,
  flightListPage,
  flightPath,
  relativeAge,
} from "../../src/views/flightPages";
import { trackDistanceMetres } from "../../src/services/flightSegmentation";
import { trackShape } from "../../src/services/trackShape";
import { SPEED_BAND_COUNT } from "../../src/services/trackBanding";
import { SPEED_RAMP } from "../../src/views/theme";
import type { DeviceStatus, FlightSummary, TrackPoint } from "../../src/db/flightRepository";
import { toFeet, toKnots } from "../../src/services/units";

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
    // Computed with the real helpers rather than hardcoded, so the fixture cannot drift from what
    // the repository would actually hand the view.
    distanceM: trackDistanceMetres(points),
    maxElevM: Math.max(...points.map((p) => p.altitudeM)),
    minElevM: Math.min(...points.map((p) => p.altitudeM)),
    shape: trackShape(points, 32),
  };
}

/** The single JSON payload the detail page hands to its client script. */
function payloadOf(html: string): {
  startedAt: number;
  points: Array<[number, number, number, number, number, number]>;
  bands: Array<{ band: number; color: string; ranges: Array<[number, number]> }>;
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

  it("colours each band from the shared ramp so the legend matches the line", () => {
    const points = track(200, (i) => i * 0.5);

    const { bands } = payloadOf(flightDetailPage(summaryFor(points), points));

    for (const band of bands) {
      expect(band.color).toBe(SPEED_RAMP[band.band]);
    }
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

  it("explains what the colours of the line mean", () => {
    // A speed-coloured track with no key is a decoration. One swatch per band, in ramp order.
    const points = track(300, (i) => i * 0.2);

    const html = flightDetailPage(summaryFor(points), points);
    const swatches = html.match(/class="legend-step"[^>]*background:\s*(#[0-9a-f]{6})/g) ?? [];

    expect(swatches).toHaveLength(SPEED_BAND_COUNT);
    SPEED_RAMP.forEach((step) => expect(html).toContain(step));
  });

  it("labels the legend with this flight's own speeds, not a fixed scale", () => {
    // The ramp is relative to the flight's fastest point, so the top of the legend has to be the
    // same number the stats report as the maximum.
    const points = track(300, (i) => (i < 150 ? 10 : 40));
    const flight = summaryFor(points);

    const html = flightDetailPage(flight, points);
    const legend = /<div class="legend"[\s\S]*?<\/div>\s*<\/div>/.exec(html);

    expect(legend).not.toBeNull();
    expect(legend![0]).toContain(String(Math.round(toKnots(flight.maxSpeedMps))));
    expect(legend![0]).toContain("kt");
  });

  it("gives the legend a text description rather than colour alone", () => {
    const points = track(60, () => 30);

    const html = flightDetailPage(summaryFor(points), points);

    expect(html).toMatch(/aria-label="[^"]*kt[^"]*"/);
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

  it("states distance, speed and elevation in the units an aircraft is flown in", () => {
    const points = track(60, () => 45);

    const html = flightDetailPage(summaryFor(points), points);

    expect(html).toContain("NM");
    expect(html).toContain("87 kt");
    expect(html).toContain("984");
    // Not "km/h appears nowhere" - the GS tile keeps a metric second line, and that is the point.
    // Exactly one occurrence: the primary reading of every quantity is aeronautical.
    expect(html.match(/km\/h/g) ?? []).toHaveLength(1);
  });

  it("keeps the metric reading on the tiles that have one", () => {
    // The same data also gets read from a car. Duración has no unit system, Puntos is a count and
    // Precisión GPS is already metric, so only three tiles carry a second line.
    const points = track(60, () => 45);

    const html = flightDetailPage(summaryFor(points), points);
    const metrics = html.match(/class="stat-metric"/g) ?? [];

    expect(metrics).toHaveLength(3);
    expect(html).toContain("162 km/h");
  });

  it("names the ground speed and the true track rather than airspeed and heading", () => {
    // getSpeed is speed over the ground - there is no pitot tube - and getBearing is relative to
    // true north, so a reader who takes it for a compass heading eats the declination as error.
    const points = track(10);

    const html = flightDetailPage(summaryFor(points), points);

    expect(html).toContain(">GS<");
    expect(html).toContain(">TRK<");
    expect(html).not.toContain(">Rumbo<");
    expect(html).not.toContain(">Velocidad<");
  });

  it("names the elevation for the datum it is actually measured against (Task 4 half)", () => {
    // Not "altitud": it is neither above mean sea level nor pressure altitude, and calling it
    // altitude is the first step toward believing it. The datum itself is stated once, in visible
    // text under the profile - Task 5 renders it and asserts it. Do not add a second statement of
    // it here, and do not hide it in a title attribute: a qualification this load-bearing does not
    // belong somewhere a touch or keyboard reader never reaches.
    const points = track(10);

    const html = flightDetailPage(summaryFor(points), points);

    expect(html).toContain("ELEV GPS");
  });

  it("carries an elevation in feet for every point so the readout can state one", () => {
    const points = track(3);
    points[1].altitudeM = 600;

    const payload = payloadOf(flightDetailPage(summaryFor(points), points));

    expect(payload.points.map((p) => p[5])).toEqual([
      Math.round(toFeet(300)),
      Math.round(toFeet(600)),
      Math.round(toFeet(300)),
    ]);
  });

  it("appends elevation rather than inserting it, so the older readings keep their slots", () => {
    const points = track(3, (i) => 10 + i);

    const payload = payloadOf(flightDetailPage(summaryFor(points), points));

    expect(payload.points[0][2]).toBe(10);
    expect(payload.points[0][4]).toBe(187);
    expect(payload.points[0]).toHaveLength(6);
  });

  it("draws the elevation as a profile rather than leaving it to a number", () => {
    const points = track(600);

    const html = flightDetailPage(summaryFor(points), points);

    expect(html).toContain('class="profile-svg"');
    expect(html).toContain('id="profile-cursor"');
    expect(html).toMatch(/class="profile-envelope"/);
  });

  it("states the datum the elevation is measured against, in visible text", () => {
    // "ELEV GPS" alone names nothing a reader can check. The qualification lives here, once, in
    // the profile note - not in a title attribute a touch or keyboard reader never reaches.
    const points = track(600);

    const html = flightDetailPage(summaryFor(points), points);
    const note = /<span class="profile-note">([\s\S]*?)<\/span>/.exec(html);

    expect(note).not.toBeNull();
    expect(note![1]).toContain("WGS84");
  });

  it("shades the profile where the recorded value simply repeated", () => {
    // The fixture track never changes altitude, which is exactly the ground behaviour the warning
    // describes. Every column should be shaded at full strength.
    const points = track(600);

    const html = flightDetailPage(summaryFor(points), points);
    const shading = html.match(/class="profile-frozen" fill-opacity="([\d.]+)"/g) ?? [];

    expect(shading.length).toBeGreaterThan(0);
    expect(html).toContain('fill-opacity="0.550"');
  });

  it("leaves the profile unshaded when the value actually moves", () => {
    const points = track(600, () => 30);
    points.forEach((p, i) => {
      p.altitudeM = 300 + i;
    });

    const html = flightDetailPage(summaryFor(points), points);

    expect(html).not.toContain('class="profile-frozen"');
  });

  it("scales a flat profile to the floor instead of magnifying the quantisation", () => {
    // 0.3 m of recorded variation. Autoscaled, 10 cm of noise would fill the frame.
    const points = track(600);
    points.forEach((p, i) => {
      p.altitudeM = 300 + (i % 4) * 0.1;
    });

    const html = flightDetailPage(summaryFor(points), points);
    const axis = /<div class="profile-axis">([\s\S]*?)<\/div>/.exec(html);

    expect(axis).not.toBeNull();
    const labels = (axis![1].match(/-?\d+/g) ?? []).map(Number);
    expect(Math.max(...labels) - Math.min(...labels)).toBe(100);
  });

  it("keeps every envelope rect inside the frame, including the lowest column", () => {
    // A flat column at the flight's lowest recorded value lands on the viewBox floor exactly, and
    // the minimum height that keeps a flat column visible would push it past the edge, where the
    // SVG clips it away. Those lowest columns are the stationary ground stretches this chart
    // exists to show, so losing them silently loses the point of the feature.
    const points = track(600);
    points.forEach((p, i) => {
      p.altitudeM = 300 + i;
    });

    const html = flightDetailPage(summaryFor(points), points);
    const rects = [
      ...html.matchAll(/class="profile-envelope" x="\d+" y="([\d.]+)" width="1" height="([\d.]+)"/g),
    ];

    expect(rects.length).toBeGreaterThan(0);
    for (const [, y, height] of rects) {
      expect(Number(y)).toBeGreaterThanOrEqual(0);
      expect(Number(y) + Number(height)).toBeLessThanOrEqual(120);
    }
  });

  it("omits the profile for a flight that has no shape to draw", () => {
    const points = track(1);

    const html = flightDetailPage(summaryFor(points), points);

    expect(html).not.toContain('class="profile-svg"');
  });

  it("keeps the map, the profile and the inspector in that order as one card", () => {
    const points = track(120);

    const html = flightDetailPage(summaryFor(points), points);

    expect(html.indexOf('id="map"')).toBeLessThan(html.indexOf('class="profile"'));
    expect(html.indexOf('class="profile"')).toBeLessThan(html.indexOf('class="inspector"'));
  });

  it("no longer claims the altitude is not graphed, but still says it is not trustworthy", () => {
    const points = track(10);

    const html = flightDetailPage(summaryFor(points), points);

    expect(html).toContain("no es confiable");
    expect(html).not.toContain("no se grafica");
    expect(html).toContain("sombreada");
  });

  it("paints a wholly frozen track as one band rather than one rect per column", () => {
    // Sub-pixel rects composite independently, so a row of 0.46 px neighbours renders lighter than
    // the opacity the contrast test certifies. On a phone that is the shading - the evidence -
    // quietly fading out.
    const points = track(600);

    const html = flightDetailPage(summaryFor(points), points);
    const shading = html.match(/class="profile-frozen"/g) ?? [];

    expect(shading).toHaveLength(1);
    expect(html).toContain('fill-opacity="0.550"');
  });

  it("does not offer the absence of shading as proof the elevation can be trusted", () => {
    // Frozen samples need a terrain source AND near-zero displacement between fixes. In flight only
    // the second condition fails, so the marks vanish whatever the source is. An operator reading
    // their absence as a verdict would be over-trusting exactly what this page exists to warn
    // about, so the copy has to name the real in-flight discriminator: the shape of the trace
    // against field elevation while the aircraft climbs.
    const points = track(10);

    const html = flightDetailPage(summaryFor(points), points);
    const warning = /<div class="warning">([\s\S]*?)<\/div>/.exec(html);

    expect(warning).not.toBeNull();
    // Whitespace collapsed first: the copy is wrapped across source lines, and where those breaks
    // fall is not a requirement. Asserting the raw string makes reflowing the paragraph fail the
    // test for a reason that has nothing to do with what it is checking.
    const claim = warning![1].replace(/\s+/g, " ");

    expect(claim).toContain("sombreada");
    expect(claim).toContain("En vuelo no dice nada");
    expect(claim).toContain("trepa");
  });
});

describe("relativeAge", () => {
  const NOW = Date.parse("2026-09-09T12:00:00.000Z");

  it("stays vague below a minute rather than counting seconds it cannot know", () => {
    // The page is rendered on the server, so a second count is stale before it is read.
    expect(relativeAge(NOW - 3_000, NOW)).toBe("hace instantes");
    expect(relativeAge(NOW - 44_000, NOW)).toBe("hace instantes");
  });

  it("steps up through minutes, hours and days", () => {
    expect(relativeAge(NOW - 5 * 60_000, NOW)).toBe("hace 5 min");
    expect(relativeAge(NOW - 3 * 3_600_000, NOW)).toBe("hace 3 h");
    expect(relativeAge(NOW - 9 * 86_400_000, NOW)).toBe("hace 9 d");
  });

  it("never reports the future, which a queued packet can produce", () => {
    // A phone with a skewed clock can hand the server a capture time slightly ahead of now.
    expect(relativeAge(NOW + 30_000, NOW)).toBe("hace instantes");
  });
});

describe("flightListPage", () => {
  /** A flight that ended `agoMillis` before `now`, however long it lasted. */
  function flightEnding(agoMillis: number, now: number, count = 60): FlightSummary {
    const points = track(count, () => 45);
    const endedAt = new Date(now - agoMillis);
    const startedAt = new Date(endedAt.getTime() - (count - 1) * SECOND);
    return { ...summaryFor(points), startedAt, endedAt };
  }

  function device(label: string, lastSeenAgoMillis: number | null, now: number): DeviceStatus {
    return {
      deviceId: `9f1c8a2e-0000-4000-8000-${label.length.toString().padStart(12, "0")}`,
      deviceLabel: label,
      lastSeenAt: lastSeenAgoMillis === null ? null : new Date(now - lastSeenAgoMillis),
    };
  }

  const NOW = Date.parse("2026-09-09T15:00:00.000Z");

  it("teaches the reader what to do when there are no flights yet", () => {
    const html = flightListPage({ flights: [], devices: [], nowMillis: NOW });

    expect(html).toContain("Todavía no hay vuelos");
  });

  it("still shows the fleet when no device has ever produced a flight", () => {
    // The failure this strip exists for: a phone whose background service was killed reports
    // nothing, so it has no flight to appear in and a flights-only page hides it completely.
    const html = flightListPage({
      flights: [],
      devices: [device("Celular parado", null, NOW)],
      nowMillis: NOW,
    });

    expect(html).toContain("Celular parado");
    expect(html).toContain("nunca reportó");
  });

  it("marks a device that has gone quiet for over a week", () => {
    const html = flightListPage({
      flights: [],
      devices: [device("Diego", 9 * 86_400_000, NOW), device("Principal", 2 * 3_600_000, NOW)],
      nowMillis: NOW,
    });

    expect(html).toContain("sin señal hace 9 d");
    expect(html).toContain("fleet-item--silent");
    // Two hours quiet is a parked aircraft, not a problem, and must not be dressed as one.
    expect(html).toContain("fleet-item--quiet");
  });

  it("says a flight is in progress when its last packet just landed", () => {
    const html = flightListPage({
      flights: [flightEnding(20_000, NOW)],
      devices: [device("Principal", 20_000, NOW)],
      nowMillis: NOW,
    });

    expect(html).toContain("En curso");
    expect(html).toContain(`class="open open--live"`);
    expect(html).toContain("último paquete hace instantes");
  });

  it("does not claim a flight is over while nothing has closed it", () => {
    // Four minutes of silence is longer than a missed upload cycle and far shorter than the gap
    // that ends a flight. The aircraft may be inside a coverage hole with its packets queued on
    // the phone, so "Último vuelo" would answer the operator's own question wrongly.
    const html = flightListPage({
      flights: [flightEnding(4 * 60_000, NOW)],
      devices: [],
      nowMillis: NOW,
    });

    expect(html).toContain("Sin señal");
    expect(html).toContain("nada lo cerró todavía");
    expect(html).not.toContain("Último vuelo");
    // Not live either - the pulse belongs to a flight that is actually reporting. Matched on the
    // attribute: the rule .open--live is in the inlined stylesheet regardless.
    expect(html).not.toContain(`class="open open--live"`);
    expect(html).toContain(`class="open open--pending"`);
  });

  it("keeps refreshing while a flight is unclosed, not only while it is reporting", () => {
    // The state that says "nada lo cerró todavía" is the state waiting for the offline queue to
    // drain. Gating the reload on `live` alone froze the page's one uncertain state, leaving it
    // unable to ever resolve its own question.
    const html = flightListPage({
      flights: [flightEnding(4 * 60_000, NOW)],
      devices: [],
      nowMillis: NOW,
    });

    expect(html).toContain("location.reload()");
    expect(html).toContain("vuelo sin cerrar");
  });

  it("draws a pending flight without a closing rule, because nothing closed it", () => {
    // The open line's one distinguishing mark is its missing bottom rule, and a flight the page
    // says nothing has closed must not be drawn as a closed entry.
    const closed = flightListPage({
      flights: [flightEnding(6 * 3_600_000, NOW)],
      devices: [],
      nowMillis: NOW,
    });

    expect(closed).toContain(`class="open open--closed"`);
    expect(closed).not.toContain("location.reload()");
  });

  it("states the date on the open entry, not just a clock time", () => {
    // A clock time alone reads fine for a flight that landed an hour ago and says nothing at all
    // about one from last week.
    const html = flightListPage({
      flights: [flightEnding(80 * 3_600_000, NOW)],
      devices: [],
      nowMillis: NOW,
    });
    const when = /<span class="open-when">([^<]*)<\/span>/.exec(html);

    expect(when).not.toBeNull();
    expect(when![1]).toMatch(/\w+, \d+ de \w+/);
  });

  it("remembers whether the reader had the roster open", () => {
    // The live reload re-emits the roster's server-side default every thirty seconds, which would
    // reopen a roster the operator had just closed, for the whole flight.
    const html = flightListPage({
      flights: [flightEnding(20_000, NOW)],
      devices: [device("Diego", 9 * 86_400_000, NOW)],
      nowMillis: NOW,
    });

    expect(html).toContain("sessionStorage");
    expect(html).toContain("rsa.fleet");
  });

  it("refreshes itself only while something is flying", () => {
    const live = flightListPage({ flights: [flightEnding(20_000, NOW)], devices: [], nowMillis: NOW });
    const done = flightListPage({
      flights: [flightEnding(6 * 3_600_000, NOW)],
      devices: [],
      nowMillis: NOW,
    });

    expect(live).toContain("location.reload()");
    expect(live).toContain("Se actualiza sola");
    // A finished flight reloading every 30 s would spend a free-tier server on nobody.
    expect(done).not.toContain("location.reload()");
    expect(done).toContain("Último vuelo");
  });

  it("groups flights by the local day, naming the two a reader actually asks for", () => {
    const flights = [
      flightEnding(2 * 3_600_000, NOW), // lead: today, becomes the open entry
      flightEnding(5 * 3_600_000, NOW), // today
      flightEnding(30 * 3_600_000, NOW), // yesterday
      flightEnding(80 * 3_600_000, NOW), // older, gets a date
    ];

    const html = flightListPage({ flights, devices: [], nowMillis: NOW });

    expect(html).toContain(">Hoy<");
    expect(html).toContain(">Ayer<");
    expect(html).toMatch(/class="day-name">\s*\w+, \d+ de \w+/);
  });

  it("keeps the newest flight in its own date group", () => {
    // The bug this pins: the newest flight is also shown above as the open entry, and an earlier
    // version built the date groups from the remainder - so a day with two flights listed one.
    // A logbook that undercounts the day is not a record of anything.
    const flights = [flightEnding(2 * 3_600_000, NOW), flightEnding(5 * 3_600_000, NOW)];

    const html = flightListPage({ flights, devices: [], nowMillis: NOW });
    const today = /<h2 class="day-heading">[\s\S]*?<\/h2>\s*<ol class="rows">([\s\S]*?)<\/ol>/.exec(
      html
    );

    expect(today).not.toBeNull();
    expect(today![1].match(/class="row"/g) ?? []).toHaveLength(2);
  });

  it("foots each day with its own totals, the way a logbook does", () => {
    const flights = [flightEnding(2 * 3_600_000, NOW), flightEnding(5 * 3_600_000, NOW)];

    const html = flightListPage({ flights, devices: [], nowMillis: NOW });
    const total = /<span class="day-total">([^<]*)<\/span>/.exec(html);

    expect(total).not.toBeNull();
    expect(total![1]).toContain("2 vuelos");
    expect(total![1]).toContain("NM");
  });

  it("links every ledger row to its own flight", () => {
    const flights = [flightEnding(3 * 3_600_000, NOW), flightEnding(5 * 3_600_000, NOW)];

    const html = flightListPage({ flights, devices: [], nowMillis: NOW });
    const hrefs = [...html.matchAll(/href="\/flights\/[^"]+"/g)];

    // One per row, plus the open entry, which points at the newest flight a second time. The open
    // entry is a shortcut to the top of the book rather than a replacement for that line.
    expect(hrefs).toHaveLength(flights.length + 1);
    for (const f of flights) expect(html).toContain(flightPath(f));
  });

  it("gives a screen reader one sentence per row instead of seven loose numerals", () => {
    // Every cell is aria-hidden, so the link's own label is the only thing announced. Columns
    // without their headings are what this redesign set out to stop shipping.
    const flights = [flightEnding(3 * 3_600_000, NOW), flightEnding(5 * 3_600_000, NOW)];

    const html = flightListPage({ flights, devices: [], nowMillis: NOW });
    const row = /<a class="entry"[\s\S]*?<\/a>/.exec(html);

    expect(row).not.toBeNull();
    expect(row![0]).toMatch(/aria-label="[^"]*duración[^"]*distancia[^"]*GS máxima[^"]*puntos/);
    expect(row![0].match(/aria-hidden="true"/g) ?? []).not.toHaveLength(0);
  });

  it("draws each flight's track as a glyph so a shape can be recognised before a date is read", () => {
    const flights = [flightEnding(3 * 3_600_000, NOW), flightEnding(5 * 3_600_000, NOW)];

    const html = flightListPage({ flights, devices: [], nowMillis: NOW });

    // Two rows plus the open entry's larger glyph.
    expect(html.match(/class="glyph-line"/g) ?? []).toHaveLength(3);
    expect(html).toContain("glyph--lg");
  });

  it("omits the polyline for a flight with no shape rather than drawing a dot", () => {
    const single = { ...summaryFor(track(1)), shape: [], distanceM: 0 };

    const html = flightListPage({ flights: [single], devices: [], nowMillis: NOW });

    // Matched on the attribute, not the bare word: the stylesheet is inlined into every page, so
    // `.glyph-line` is present in the CSS whether or not any row draws one.
    expect(html).not.toContain('class="glyph-line"');
    expect(html).toContain("glyph--none");
  });

  it("reads in aviation units, with the unit named once per column", () => {
    const html = flightListPage({
      flights: [flightEnding(3 * 3_600_000, NOW), flightEnding(5 * 3_600_000, NOW)],
      devices: [],
      nowMillis: NOW,
    });

    expect(html).not.toContain("km/h");
    expect(html).toContain(">NM<");
    // The wide layout names the column in the header; the narrow one hides that header, so the
    // per-cell chip has to say the speed is a maximum on its own.
    expect(html).toContain(">GS máx<");
    expect(html).toContain(">kt máx<");
  });

  it("carries the elevation on the index, in the colour that qualifies it", () => {
    // The operator asked for the altitude. It is on the ledger and on the open line, in feet, and
    // in warnInk everywhere it appears - including its own column header - because what that
    // figure is worth is not what the four beside it are worth.
    const points = track(60, () => 45);
    points[30].altitudeM = 920;

    const html = flightListPage({
      flights: [{ ...summaryFor(points), startedAt: new Date(NOW - 3_600_000), endedAt: new Date(NOW - 60_000) }],
      devices: [],
      nowMillis: NOW,
    });

    expect(html).toContain(`class="cell--num stat-warn">ELEV máx<`);
    expect(html).toContain(">ft máx<");
    // 920 m is 3018 ft.
    expect(html).toContain(">3018<");
    // 45 m/s is 87 kt, and the ledger carries the bare numeral under its heading.
    expect(html).toContain(">87<");
  });

  it("does not offer a back link on the page it would return to", () => {
    const html = flightListPage({
      flights: [flightEnding(3 * 3_600_000, NOW)],
      devices: [],
      nowMillis: NOW,
    });

    expect(html).not.toContain('class="back"');
  });
});
