import { describe, expect, it } from "vitest";
import {
  MINIMUM_SPAN_FT,
  type ProfileSample,
  profileColumns,
  profileScale,
} from "../../src/services/verticalProfile";

const SECOND = 1000;
const BASE = Date.parse("2026-09-07T22:16:00.000Z");

/** A 1 Hz run, which is what the app records. */
function samples(count: number, altitudeAt: (i: number) => number = () => 300): ProfileSample[] {
  return Array.from({ length: count }, (_, i) => ({
    capturedAt: new Date(BASE + i * SECOND),
    altitudeM: altitudeAt(i),
  }));
}

describe("profileColumns", () => {
  it("draws nothing from a track that has no shape yet", () => {
    expect(profileColumns([], 720)).toEqual([]);
    expect(profileColumns(samples(1), 720)).toEqual([]);
  });

  it("rejects a column count that cannot describe a chart", () => {
    expect(() => profileColumns(samples(10), 0)).toThrow(/positive integer/);
    expect(() => profileColumns(samples(10), 2.5)).toThrow(/positive integer/);
  });

  it("treats the column count as a ceiling, not a target", () => {
    // 720 columns over a 90 second flight would be 630 empty ones.
    expect(profileColumns(samples(90), 720)).toHaveLength(90);
    expect(profileColumns(samples(5000), 720)).toHaveLength(720);
  });

  it("keeps the extremes of each column rather than averaging them away", () => {
    // One spike in a column of otherwise flat samples. A mean would eat it.
    const points = samples(100, (i) => (i === 42 ? 900 : 300));

    const columns = profileColumns(points, 10);
    const spiked = columns.filter((c) => c.maxFt > 1000);

    expect(spiked).toHaveLength(1);
    expect(spiked[0].maxFt).toBeCloseTo(900 / 0.3048, 6);
    expect(spiked[0].minFt).toBeCloseTo(300 / 0.3048, 6);
  });

  it("reports a fraction frozen rather than a verdict", () => {
    // Every other sample repeats its predecessor exactly.
    const points = samples(101, (i) => 300 + Math.floor(i / 2) * 0.1);

    const [column] = profileColumns(points, 1);

    expect(column.frozenFraction).toBeCloseTo(0.5, 2);
  });

  it("marks a stream that never moves as entirely frozen", () => {
    const [column] = profileColumns(samples(100), 1);

    expect(column.frozenFraction).toBe(1);
    expect(column.sampleCount).toBe(100);
  });

  it("marks a stream that always moves as never frozen", () => {
    const [column] = profileColumns(samples(100, (i) => 300 + i), 1);

    expect(column.frozenFraction).toBe(0);
  });

  it("excludes the very first sample from its column's denominator", () => {
    // The first sample has no predecessor, so it is neither frozen nor not-frozen. Counting it
    // either way would make the first column state something it cannot know.
    const points = samples(3, () => 300);

    const [first] = profileColumns(points, 1);

    // Three samples, two comparisons, both frozen - not two out of three.
    expect(first.frozenFraction).toBe(1);
  });

  it("buckets by elapsed time, not by sample index", () => {
    // The offline queue makes the two diverge: 10 samples in the first second, then one a minute
    // later. By index they would split down the middle; by time the first ten share one column.
    const points: ProfileSample[] = [
      ...Array.from({ length: 10 }, (_, i) => ({
        capturedAt: new Date(BASE + i * 100),
        altitudeM: 300,
      })),
      { capturedAt: new Date(BASE + 60 * SECOND), altitudeM: 900 },
    ];

    const columns = profileColumns(points, 10);

    expect(columns[0].sampleCount).toBe(10);
    expect(columns[columns.length - 1].sampleCount).toBe(1);
  });

  it("leaves a coverage gap empty instead of inventing a value across it", () => {
    // An interpolated line over a gap is a measurement nobody took.
    const points: ProfileSample[] = [
      { capturedAt: new Date(BASE), altitudeM: 300 },
      { capturedAt: new Date(BASE + SECOND), altitudeM: 300 },
      { capturedAt: new Date(BASE + 600 * SECOND), altitudeM: 900 },
    ];

    const columns = profileColumns(points, 10);
    const empty = columns.filter((c) => c.sampleCount === 0);

    expect(empty.length).toBeGreaterThan(0);
    for (const column of empty) {
      expect(column.minFt).toBe(0);
      expect(column.maxFt).toBe(0);
      expect(column.frozenFraction).toBe(0);
    }
  });

  it("numbers each column with its own x so the view needs no index arithmetic", () => {
    const columns = profileColumns(samples(50), 10);

    expect(columns.map((c) => c.x)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("profileScale", () => {
  it("uses the observed range when the flight actually climbed", () => {
    const columns = profileColumns(samples(100, (i) => 300 + i * 10), 10);

    const scale = profileScale(columns);

    expect(scale.maxFt - scale.minFt).toBeGreaterThan(MINIMUM_SPAN_FT);
    expect(scale.maxFt).toBeCloseTo(1290 / 0.3048, 6);
  });

  it("pads a flat track to a floor so quantisation does not read as terrain", () => {
    // 0.3 m of recorded variation autoscaled to the frame turns 10 cm of noise into a mountain.
    const columns = profileColumns(samples(100, (i) => 300 + (i % 4) * 0.1), 10);

    const scale = profileScale(columns);

    expect(scale.maxFt - scale.minFt).toBeCloseTo(MINIMUM_SPAN_FT, 6);
  });

  it("centres the padded span on the observed midpoint rather than its floor", () => {
    // Anchored at the minimum, a flat track drops to the bottom of the frame and reads as "low"
    // instead of as "unchanging".
    const columns = profileColumns(samples(100), 10);
    const flatFt = 300 / 0.3048;

    const scale = profileScale(columns);

    expect((scale.minFt + scale.maxFt) / 2).toBeCloseTo(flatFt, 6);
    expect(scale.minFt).toBeCloseTo(flatFt - MINIMUM_SPAN_FT / 2, 6);
  });

  it("returns a drawable frame for a track with no columns at all", () => {
    const scale = profileScale([]);

    expect(scale.maxFt - scale.minFt).toBe(MINIMUM_SPAN_FT);
  });
});
