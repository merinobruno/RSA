import { describe, expect, it } from "vitest";
import {
  KNOTS_PER_MPS,
  formatKnots,
  formatNauticalMiles,
  toFeet,
  toKnots,
  toNauticalMiles,
} from "../../src/services/units";

describe("aviation units", () => {
  it("defines a knot as one nautical mile per hour", () => {
    expect(toKnots(1852 / 3600)).toBeCloseTo(1, 10);
  });

  it("defines a foot as exactly 0.3048 m", () => {
    expect(toFeet(0.3048)).toBeCloseTo(1, 10);
  });

  it("defines a nautical mile as exactly 1852 m", () => {
    expect(toNauticalMiles(1852)).toBeCloseTo(1, 10);
  });

  it("hands the client script the same factor the server uses", () => {
    // The inline script converts speed for the readout itself. If these two ever drift, the map's
    // readout and the stat tile above it report different speeds for the same point.
    expect(KNOTS_PER_MPS).toBeCloseTo(1.943844, 6);
  });

  it("states speed in whole knots", () => {
    // 45 m/s is 87.47 kt. Nobody reads a decimal off an ASI, and one here would claim a precision
    // the receiver does not have.
    expect(formatKnots(45)).toBe("87 kt");
    expect(formatKnots(0)).toBe("0 kt");
  });

  it("states distance in nautical miles to one decimal", () => {
    // The 223 km field test.
    expect(formatNauticalMiles(223000)).toBe("120.4 NM");
  });
});
