import { describe, expect, it } from "vitest";
import { trackShape } from "../../src/services/trackShape";

/** Neuquén, where this fleet flies. cos(38.93°) is about 0.778. */
const LAT = -38.93;
const LON = -67.97;

function extent(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

describe("trackShape", () => {
  it("draws nothing for a track with no shape", () => {
    expect(trackShape([], 32)).toEqual([]);
    expect(trackShape([{ lat: LAT, lon: LON }], 32)).toEqual([]);
  });

  it("rejects a point budget that cannot describe a line", () => {
    expect(() => trackShape([{ lat: LAT, lon: LON }], 1)).toThrow(/at least 2/);
    expect(() => trackShape([{ lat: LAT, lon: LON }], 2.5)).toThrow(/at least 2/);
  });

  it("stays within its budget and keeps both ends", () => {
    const points = Array.from({ length: 5000 }, (_, i) => ({ lat: LAT + i * 0.0001, lon: LON }));

    const shape = trackShape(points, 32);

    expect(shape.length).toBeLessThanOrEqual(32);
    expect(shape.length).toBeGreaterThan(2);
    // The last fix is where the flight ended; dropping it would shorten every track by up to a
    // whole sampling step.
    expect(shape[0].y).toBeCloseTo(1, 3);
    expect(shape[shape.length - 1].y).toBeCloseTo(0, 3);
  });

  it("normalises into the unit box", () => {
    const points = Array.from({ length: 40 }, (_, i) => ({
      lat: LAT + i * 0.002,
      lon: LON + i * 0.002,
    }));

    for (const p of trackShape(points, 32)) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });

  it("keeps a straight north-south leg vertical", () => {
    // Scaling each axis to its own extent would stretch this into a diagonal across the box.
    const points = Array.from({ length: 20 }, (_, i) => ({ lat: LAT + i * 0.005, lon: LON }));

    const shape = trackShape(points, 32);

    expect(extent(shape.map((p) => p.x))).toBeCloseTo(0, 3);
    expect(extent(shape.map((p) => p.y))).toBeCloseTo(1, 3);
    for (const p of shape) expect(p.x).toBeCloseTo(0.5, 3);
  });

  it("puts north at the top, where a reader expects it", () => {
    const points = [
      { lat: LAT, lon: LON },
      { lat: LAT + 0.05, lon: LON },
    ];

    const [south, north] = trackShape(points, 32);

    // SVG's y grows downward, so the northern fix has to carry the smaller number.
    expect(north.y).toBeLessThan(south.y);
  });

  it("corrects for longitude being shorter than latitude at this latitude", () => {
    // An L of two legs, each 0.1 degrees. Uncorrected they would render equal; in metres the
    // east-west leg is cos(38.93) of the other, about 78%.
    const points = [
      { lat: LAT, lon: LON },
      { lat: LAT + 0.1, lon: LON },
      { lat: LAT + 0.1, lon: LON + 0.1 },
    ];

    const shape = trackShape(points, 32);

    expect(extent(shape.map((p) => p.y))).toBeCloseTo(1, 2);
    expect(extent(shape.map((p) => p.x))).toBeCloseTo(0.778, 2);
  });

  it("draws a tight circuit small instead of blowing it up to the full box", () => {
    // Roughly a 100 m square. Normalising it to the same box as a cross-country would make a
    // circuit round the field and a 200 km leg look identical.
    const d = 100 / 111320;
    const points = [
      { lat: LAT, lon: LON },
      { lat: LAT + d, lon: LON },
      { lat: LAT + d, lon: LON + d / 0.778 },
      { lat: LAT, lon: LON + d / 0.778 },
      { lat: LAT, lon: LON },
    ];

    const shape = trackShape(points, 32);

    // 100 m against the 400 m floor.
    expect(extent(shape.map((p) => p.y))).toBeCloseTo(0.25, 2);
    expect(extent(shape.map((p) => p.x))).toBeCloseTo(0.25, 2);
  });

  it("centres whatever it drew", () => {
    const points = [
      { lat: LAT, lon: LON },
      { lat: LAT + 0.2, lon: LON },
    ];

    const shape = trackShape(points, 32);
    const xs = shape.map((p) => p.x);

    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(0.5, 3);
  });
});
