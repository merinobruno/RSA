import { describe, expect, it } from "vitest";
import { SPEED_RAMP, bandSpeedBoundsKt } from "../../src/views/theme";
import { toKnots } from "../../src/services/units";

describe("bandSpeedBoundsKt", () => {
  it("gives one bound per ramp step", () => {
    expect(bandSpeedBoundsKt(40)).toHaveLength(SPEED_RAMP.length);
  });

  it("tops out at the flight's own fastest point", () => {
    const bounds = bandSpeedBoundsKt(40);

    expect(bounds[bounds.length - 1].toKt).toBe(Math.round(toKnots(40)));
    expect(bounds[0].fromKt).toBe(0);
  });

  it("stays drawable for a flight that never moved", () => {
    const bounds = bandSpeedBoundsKt(0);

    expect(bounds.every((b) => b.fromKt === 0 && b.toKt === 0)).toBe(true);
  });

  it("leaves no gap or overlap between neighbouring slices", () => {
    // Ported from the bandSpeedBoundsKmh block this rename retires. A legend with a gap between
    // two swatches describes a speed the line can be drawn in but the key does not name.
    const bounds = bandSpeedBoundsKt(50);

    for (let i = 1; i < bounds.length; i++) {
      expect(bounds[i].fromKt).toBe(bounds[i - 1].toKt);
    }
  });
});
