import { describe, expect, it } from "vitest";
import { DARK, HEADER, LIGHT, type Palette } from "../../src/views/theme";

/**
 * WCAG 2.1 relative luminance and contrast ratio, straight from the spec.
 *
 * Computed in the test rather than imported from the views: production has no reason to know how to
 * measure a colour, and a helper shared with the code under test would let one bug satisfy both.
 */
function channelLuminance(srgb: number): number {
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  return (
    0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
  );
}

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA, normal-size text. Every timestamp and stat label on the dashboard is 13-14px. */
const TEXT_MINIMUM = 4.5;
/** WCAG AA, non-text UI: borders, focus rings, markers. */
const UI_MINIMUM = 3;

describe("contrastRatio", () => {
  it("agrees with the spec on the two extremes", () => {
    // Proves the measuring stick before anything is measured with it.
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });

  it("does not care which colour is given first", () => {
    expect(contrastRatio("#121212", "#9e9e9e")).toBeCloseTo(contrastRatio("#9e9e9e", "#121212"), 5);
  });
});

describe.each([
  ["light", LIGHT],
  ["dark", DARK],
])("%s palette", (_name, palette: Palette) => {
  it("renders body text readably on the page", () => {
    expect(contrastRatio(palette.ink, palette.bg)).toBeGreaterThanOrEqual(TEXT_MINIMUM);
  });

  it("renders body text readably on a card", () => {
    expect(contrastRatio(palette.ink, palette.surface)).toBeGreaterThanOrEqual(TEXT_MINIMUM);
  });

  it("renders secondary text readably on the page", () => {
    // Not a nicety. Every flight's date, duration, point count and top speed is secondary text.
    expect(contrastRatio(palette.muted, palette.bg)).toBeGreaterThanOrEqual(TEXT_MINIMUM);
  });

  it("renders secondary text readably on a card", () => {
    expect(contrastRatio(palette.muted, palette.surface)).toBeGreaterThanOrEqual(TEXT_MINIMUM);
  });

  it("renders link text readably on the page", () => {
    expect(contrastRatio(palette.link, palette.bg)).toBeGreaterThanOrEqual(TEXT_MINIMUM);
  });

  it("renders the altitude warning readably on its own background", () => {
    expect(contrastRatio(palette.warnInk, palette.warnBg)).toBeGreaterThanOrEqual(TEXT_MINIMUM);
  });

  it("keeps the accent visible as a border without being used for text", () => {
    expect(contrastRatio(palette.accent, palette.bg)).toBeGreaterThanOrEqual(UI_MINIMUM);
  });
});

describe("header", () => {
  it("renders its title and its back link readably on the navy band", () => {
    expect(contrastRatio(HEADER.ink, HEADER.bg)).toBeGreaterThanOrEqual(TEXT_MINIMUM);
    expect(contrastRatio(HEADER.link, HEADER.bg)).toBeGreaterThanOrEqual(TEXT_MINIMUM);
  });
});
