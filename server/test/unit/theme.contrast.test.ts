import { describe, expect, it } from "vitest";
import { DARK, HEADER, LIGHT, MAX_FROZEN_OPACITY, type Palette } from "../../src/views/theme";

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

/**
 * A floor for "perceptible as a tint", not a WCAG threshold - the spec sets none for a shaded
 * region, because a tint is not a shape whose form has to be read. The accessibility requirement
 * for this pairing is the trace-on-shading ratio below it.
 */
const TINT_MINIMUM = 1.5;

/** Alpha compositing, so a colour can be measured as it renders rather than as it is declared. */
function over(foreground: string, background: string, alpha: number): string {
  const channels = (hex: string) =>
    [0, 2, 4].map((i) => parseInt(hex.replace("#", "").slice(i, i + 2), 16));
  const [fr, fg, fb] = channels(foreground);
  const [br, bg, bb] = channels(background);

  return `#${[[fr, br], [fg, bg], [fb, bb]]
    .map(([f, b]) =>
      Math.round(f * alpha + b * (1 - alpha))
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

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

  it("renders the elevation stat readably on the page and on a card", () => {
    // The elevation tile is the one stat rendered in warnInk, and it sits on the page rather than
    // on the warning's own amber background - which is the only pairing the palette was measured
    // for until now.
    expect(contrastRatio(palette.warnInk, palette.bg)).toBeGreaterThanOrEqual(TEXT_MINIMUM);
    expect(contrastRatio(palette.warnInk, palette.surface)).toBeGreaterThanOrEqual(TEXT_MINIMUM);
  });

  it("draws the elevation profile visibly against the card it sits on", () => {
    expect(contrastRatio(palette.profileInk, palette.surface)).toBeGreaterThanOrEqual(UI_MINIMUM);
  });

  it("keeps the frozen shading visible and distinct from the trace it marks", () => {
    // Measured as it actually renders. The shading is never painted at full strength - it is a
    // tint at MAX_FROZEN_OPACITY over the card - so asserting the raw token would bind a colour
    // that never reaches a screen.
    const shading = over(palette.profileFrozen, palette.surface, MAX_FROZEN_OPACITY);

    // Visible at all against the card behind it. TINT_MINIMUM, not UI_MINIMUM: a region tint is
    // not a shape that carries meaning, so WCAG's 3:1 does not apply to this pairing.
    expect(contrastRatio(shading, palette.surface)).toBeGreaterThanOrEqual(TINT_MINIMUM);
    // This one is the real requirement. Shading that cannot be told from the trace drawn on top
    // of it turns the warning into decoration.
    expect(contrastRatio(shading, palette.profileInk)).toBeGreaterThanOrEqual(UI_MINIMUM);
  });
});

describe("header", () => {
  it("renders its title and its back link readably on the navy band", () => {
    expect(contrastRatio(HEADER.ink, HEADER.bg)).toBeGreaterThanOrEqual(TEXT_MINIMUM);
    expect(contrastRatio(HEADER.link, HEADER.bg)).toBeGreaterThanOrEqual(TEXT_MINIMUM);
  });
});
