import { describe, expect, it } from "vitest";
import { SPEED_RAMP, bandColour } from "../../src/views/theme";
import { SPEED_BAND_COUNT } from "../../src/services/trackBanding";

describe("SPEED_RAMP", () => {
  it("has exactly one colour per band", () => {
    // A ramp shorter than the band count leaves a band with no colour and the track with an
    // invisible leg; a longer one has steps the legend claims exist and the map never draws.
    expect(SPEED_RAMP).toHaveLength(SPEED_BAND_COUNT);
  });

  it("states every step as a six-digit hex so the legend and the line cannot disagree", () => {
    for (const step of SPEED_RAMP) {
      expect(step).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("uses a different colour for every step", () => {
    expect(new Set(SPEED_RAMP).size).toBe(SPEED_RAMP.length);
  });
});

describe("bandColour", () => {
  it("gives the slowest and fastest bands the ends of the ramp", () => {
    expect(bandColour(0)).toBe(SPEED_RAMP[0]);
    expect(bandColour(SPEED_BAND_COUNT - 1)).toBe(SPEED_RAMP[SPEED_BAND_COUNT - 1]);
  });

  it("clamps a band index that falls outside the ramp instead of returning nothing", () => {
    expect(bandColour(-1)).toBe(SPEED_RAMP[0]);
    expect(bandColour(SPEED_BAND_COUNT + 5)).toBe(SPEED_RAMP[SPEED_BAND_COUNT - 1]);
  });
});
