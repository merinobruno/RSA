import { describe, expect, it } from "vitest";
import { SPEED_BAND_COUNT, bandTrack, type SpeedBand } from "../../src/services/trackBanding";

/** Segments in a track of `points` points: the drawn line has one fewer than the point count. */
function segmentCount(points: number): number {
  return Math.max(points - 1, 0);
}

/** Segments a banding actually covers. A point range [a, b] spans `b - a` segments. */
function coveredSegments(bands: SpeedBand[]): number {
  return bands.reduce(
    (total, band) => total + band.ranges.reduce((n, [from, to]) => n + (to - from), 0),
    0
  );
}

describe("bandTrack", () => {
  it("returns nothing for a track that cannot be drawn", () => {
    expect(bandTrack([], SPEED_BAND_COUNT)).toEqual([]);
    expect(bandTrack([12], SPEED_BAND_COUNT)).toEqual([]);
  });

  it("collapses a constant-speed track into one band and one range", () => {
    const bands = bandTrack([30, 30, 30, 30], 6);

    expect(bands).toHaveLength(1);
    expect(bands[0].ranges).toEqual([[0, 3]]);
  });

  it("keeps a track that never moved in the slowest band", () => {
    // Every speed is zero, so there is no maximum to scale against and nothing may divide by it.
    const bands = bandTrack([0, 0, 0], 6);

    expect(bands).toHaveLength(1);
    expect(bands[0].band).toBe(0);
  });

  it("separates a slow leg from a fast leg", () => {
    // Point 0 is only a start vertex: a segment's band comes from the speed recorded at its end.
    const bands = bandTrack([0, 2, 2, 100, 100], 4);

    expect(bands.map((b) => b.band)).toEqual([0, 3]);
  });

  it("shares the boundary point between adjacent ranges so the line has no gap", () => {
    // If the slow leg ends at point 2 the fast leg has to start at point 2, or the line breaks
    // wherever the colour changes.
    const bands = bandTrack([0, 2, 2, 100, 100], 4);

    expect(bands.find((b) => b.band === 0)!.ranges).toEqual([[0, 2]]);
    expect(bands.find((b) => b.band === 3)!.ranges).toEqual([[2, 4]]);
  });

  it("accounts for every segment exactly once", () => {
    const speeds = [0, 5, 40, 41, 3, 3, 90, 12];

    expect(coveredSegments(bandTrack(speeds, 6))).toBe(segmentCount(speeds.length));
  });

  it("draws a long flight as a handful of layers, not one per segment", () => {
    // The reason this module exists. Speeds chosen to land in every band and change band constantly,
    // which is the worst case for grouping: the layer count still has to be the band count.
    const speeds = Array.from({ length: 5000 }, (_, i) => (i % 97) * 1.1);

    const bands = bandTrack(speeds, SPEED_BAND_COUNT);

    expect(bands.length).toBeLessThanOrEqual(SPEED_BAND_COUNT);
    expect(coveredSegments(bands)).toBe(segmentCount(speeds.length));
  });

  it("orders bands from slowest to fastest", () => {
    const bands = bandTrack([0, 90, 3, 45, 3], 6);

    expect(bands.map((b) => b.band)).toEqual([...bands.map((b) => b.band)].sort((a, b) => a - b));
  });

  it("rejects a band count it cannot divide a range into", () => {
    expect(() => bandTrack([0, 10], 0)).toThrow(/band count/i);
    expect(() => bandTrack([0, 10], 2.5)).toThrow(/band count/i);
  });
});
