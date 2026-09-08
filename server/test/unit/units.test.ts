import { describe, expect, it } from "vitest";
import {
  KNOTS_PER_MPS,
  formatFeet,
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

  it("states elevation in whole feet without rounding to an altimeter's steps", () => {
    // 300 m is 984.25 ft. Rounding to the nearest 10 or 20 ft the way an altimeter face does would
    // conceal the 0.1 m quantisation this dashboard exists to expose.
    expect(formatFeet(300)).toBe("984 ft");
  });

  it("keeps elevation below the ellipsoid negative rather than clamping it", () => {
    expect(formatFeet(-30.48)).toBe("-100 ft");
  });

  it("states distance in nautical miles to one decimal", () => {
    // The 223 km field test.
    expect(formatNauticalMiles(223000)).toBe("120.4 NM");
  });
});
