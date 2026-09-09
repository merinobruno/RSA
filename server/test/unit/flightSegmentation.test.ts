import { describe, expect, it } from "vitest";
import {
  DATA_GAP_MILLIS,
  LIVE_STALENESS_MILLIS,
  MOVING_SPEED_MPS,
  STATIONARY_SPLIT_MILLIS,
  findSegmentContaining,
  isInProgress,
  segmentStream,
  trackDistanceMetres,
  type StreamPoint,
} from "../../src/services/flightSegmentation";

const MINUTE = 60 * 1000;
const BASE = Date.parse("2026-09-07T12:00:00.000Z");

/** A run of points one minute apart, all at the given speed. */
function run(fromMinute: number, count: number, speedMps: number): StreamPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    atMillis: BASE + (fromMinute + i) * MINUTE,
    speedMps,
  }));
}

const MOVING = MOVING_SPEED_MPS + 10;
const STILL = 0;

describe("segmentStream", () => {
  it("returns nothing for an empty stream", () => {
    expect(segmentStream([])).toEqual([]);
  });

  it("keeps one continuous moving run as a single flight", () => {
    const flights = segmentStream(run(0, 20, MOVING));

    expect(flights).toHaveLength(1);
    expect(flights[0].packetCount).toBe(20);
  });

  it("splits where tracking was switched off", () => {
    const flights = segmentStream([...run(0, 5, MOVING), ...run(60, 5, MOVING)]);

    expect(flights).toHaveLength(2);
  });

  it("discards a run that never moved", () => {
    // A phone on a table for two hours is not a flight, and should not appear at all.
    expect(segmentStream(run(0, 120, STILL))).toEqual([]);
  });

  describe("stationary runs", () => {
    it("ends a flight when the aircraft stays put long enough to be parked", () => {
      const flights = segmentStream([
        ...run(0, 10, MOVING),
        ...run(10, 30, STILL), // half an hour parked
        ...run(40, 10, MOVING),
      ]);

      expect(flights).toHaveLength(2);
    });

    it("does not split on a short stop, which is a hold rather than a park", () => {
      const holdMinutes = STATIONARY_SPLIT_MILLIS / MINUTE - 2;
      const flights = segmentStream([
        ...run(0, 10, MOVING),
        ...run(10, holdMinutes, STILL),
        ...run(10 + holdMinutes, 10, MOVING),
      ]);

      expect(flights).toHaveLength(1);
    });

    it("removes the parked stretch instead of slicing it into pieces", () => {
      // The bug this rule was written twice to avoid: a first attempt cut at every stationary
      // point past the threshold and turned a nine-hour park into dozens of identical flights.
      const flights = segmentStream([
        ...run(0, 10, MOVING),
        ...run(10, 9 * 60, STILL), // nine hours parked
        ...run(10 + 9 * 60, 10, MOVING),
      ]);

      expect(flights).toHaveLength(2);
      expect(flights.every((f) => f.packetCount < 30)).toBe(true);
    });

    it("counts a slow but moving aircraft as flying", () => {
      // A glider circling in weak lift still has groundspeed; the threshold sits below anything
      // that is genuinely airborne.
      const flights = segmentStream(run(0, 30, MOVING_SPEED_MPS + 0.5));

      expect(flights).toHaveLength(1);
    });
  });

  it("does not merge a full day of idling into one very long flight", () => {
    // The case that forced the stationary rule to exist. Splitting only on data gaps produced a
    // single 14.6-hour flight from a phone whose idle gaps never reached fifteen minutes.
    const flights = segmentStream([
      ...run(0, 20, MOVING),
      ...run(20, 13 * 60, STILL),
      ...run(20 + 13 * 60, 20, MOVING),
    ]);

    expect(flights).toHaveLength(2);
    for (const flight of flights) {
      const minutes = (flight.endedAtMillis - flight.startedAtMillis) / MINUTE;
      expect(minutes).toBeLessThan(60);
    }
  });

  it("treats a gap of exactly the data threshold as continuous", () => {
    const flights = segmentStream([
      { atMillis: BASE, speedMps: MOVING },
      { atMillis: BASE + DATA_GAP_MILLIS, speedMps: MOVING },
    ]);

    expect(flights).toHaveLength(1);
  });

  it("splits a data gap one millisecond over the threshold", () => {
    const flights = segmentStream([
      ...run(0, 3, MOVING),
      { atMillis: BASE + 2 * MINUTE + DATA_GAP_MILLIS + 1, speedMps: MOVING },
      { atMillis: BASE + 3 * MINUTE + DATA_GAP_MILLIS + 1, speedMps: MOVING },
    ]);

    expect(flights).toHaveLength(2);
  });

  it("ignores a lone point, which describes no journey", () => {
    expect(segmentStream([{ atMillis: BASE, speedMps: MOVING }])).toEqual([]);
  });
});

describe("findSegmentContaining", () => {
  const flights = segmentStream([...run(0, 10, MOVING), ...run(60, 10, MOVING)]);

  it("finds the flight a timestamp falls inside", () => {
    expect(findSegmentContaining(flights, BASE + 5 * MINUTE)).toBe(flights[0]);
    expect(findSegmentContaining(flights, BASE + 65 * MINUTE)).toBe(flights[1]);
  });

  it("matches the boundaries themselves", () => {
    expect(findSegmentContaining(flights, flights[0].startedAtMillis)).toBe(flights[0]);
    expect(findSegmentContaining(flights, flights[0].endedAtMillis)).toBe(flights[0]);
  });

  it("returns null between two flights", () => {
    expect(findSegmentContaining(flights, BASE + 40 * MINUTE)).toBeNull();
  });

  it("still resolves a shared link after a late queued packet extends the flight backwards", () => {
    const sharedStart = flights[0].startedAtMillis;
    const extended = segmentStream([
      { atMillis: sharedStart - 30 * 1000, speedMps: MOVING },
      ...run(0, 10, MOVING),
    ]);

    expect(extended[0].startedAtMillis).toBeLessThan(sharedStart);
    expect(findSegmentContaining(extended, sharedStart)).toBe(extended[0]);
  });
});

describe("trackDistanceMetres", () => {
  it("is zero for fewer than two points", () => {
    expect(trackDistanceMetres([])).toBe(0);
    expect(trackDistanceMetres([{ lat: -38.93, lon: -67.97 }])).toBe(0);
  });

  it("measures a known north-south separation", () => {
    // 0.001 degrees of latitude is about 111 m anywhere on Earth.
    const metres = trackDistanceMetres([
      { lat: -38.93, lon: -67.97 },
      { lat: -38.931, lon: -67.97 },
    ]);

    expect(metres).toBeGreaterThan(105);
    expect(metres).toBeLessThan(120);
  });

  it("sums successive legs rather than measuring end to end", () => {
    const there = { lat: -38.93, lon: -67.97 };
    const away = { lat: -38.94, lon: -67.97 };

    // A there-and-back track covers real distance even though it ends where it began.
    expect(trackDistanceMetres([there, away, there])).toBeGreaterThan(2000);
  });
});

describe("isInProgress", () => {
  const NOW = Date.parse("2026-09-09T15:00:00.000Z");

  it("counts a flight whose packet just landed", () => {
    expect(isInProgress(NOW - 5000, NOW)).toBe(true);
  });

  it("tolerates one missed upload cycle and no more", () => {
    // The app uploads every 30 s, so a single skipped cycle is normal and must not read as landed.
    expect(isInProgress(NOW - LIVE_STALENESS_MILLIS, NOW)).toBe(true);
    expect(isInProgress(NOW - LIVE_STALENESS_MILLIS - 1, NOW)).toBe(false);
  });

  it("is far tighter than the gap that ends a flight", () => {
    // The two thresholds answer different questions: whether tracking was ever switched off, and
    // whether anything is happening right now. Sharing one value would call a flight live for a
    // quarter of an hour after the aircraft was tied down.
    expect(LIVE_STALENESS_MILLIS).toBeLessThan(DATA_GAP_MILLIS);
    expect(isInProgress(NOW - DATA_GAP_MILLIS + 1000, NOW)).toBe(false);
  });

  it("accepts a capture time slightly ahead of now", () => {
    // A phone with a skewed clock can hand the server a future timestamp; that is still live.
    expect(isInProgress(NOW + 20_000, NOW)).toBe(true);
  });
});
