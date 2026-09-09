import { toKnots } from "../services/units";

/**
 * The dashboard's colours, as data rather than as literals buried in a stylesheet.
 *
 * They live here so their contrast can be asserted. A muted grey that reads fine on a near-white
 * page can be unreadable on a dark one, and the only way to know is to compute it - which needs the
 * values reachable from a test.
 */

export interface Palette {
  /** Page background. */
  bg: string;
  /** Raised surfaces: cards, the hover readout. */
  surface: string;
  border: string;
  /** Body text. */
  ink: string;
  /** Secondary text: timestamps, stat labels, units. */
  muted: string;
  /** Non-text emphasis only - focus rings, hovered borders. */
  accent: string;
  /** Link text, which has to clear the text contrast bar rather than the UI one. */
  link: string;
  warnBg: string;
  warnBorder: string;
  warnInk: string;
  /** The elevation profile's trace. Non-text: it is a shape, not a label. */
  profileInk: string;
  /** The shading over profile columns that repeated the previous sample. */
  profileFrozen: string;
  /**
   * A flight still receiving packets, and the only saturated colour on the index.
   *
   * It carries the "en curso" label as well as the status light, so it has to clear the text bar
   * rather than the UI one. Kept distinct from [accent], which means focus and hover and would say
   * the wrong thing about an aircraft in the air.
   */
  live: string;
}

export const LIGHT: Palette = {
  bg: "#fafafa",
  surface: "#ffffff",
  border: "#e0e0e0",
  ink: "#212121",
  muted: "#616161",
  accent: "#0288d1",
  link: "#01579b",
  warnBg: "#fff8e1",
  warnBorder: "#f0d488",
  warnInk: "#5d4409",
  profileInk: "#37474f",
  profileFrozen: "#b26a00",
  live: "#0f7a3d",
};

export const DARK: Palette = {
  bg: "#121212",
  surface: "#1e1e1e",
  border: "#333333",
  ink: "#e0e0e0",
  // Not the light theme's #616161. On this background that grey measures 3.0:1, and 2.7:1 on a
  // card - which is where every flight's date, duration, point count and top speed is rendered.
  muted: "#9e9e9e",
  accent: "#4fc3f7",
  link: "#7fd4ff",
  warnBg: "#2b2418",
  warnBorder: "#4a3c1a",
  warnInk: "#e8d9b0",
  profileInk: "#b0bec5",
  profileFrozen: "#c98f2e",
  live: "#4ade80",
};

/**
 * The header keeps one navy band in both themes - it is the app's identity, not a surface that
 * follows the reader's preference - so its colours are not part of either palette.
 */
export const HEADER = {
  bg: "#0d2a54",
  ink: "#ffffff",
  link: "#9fc4ff",
} as const;

/**
 * The colour of each speed band, slowest step first - one entry per band, which the tests hold
 * equal to SPEED_BAND_COUNT. Stated as data for the same reason the palette is: the legend under
 * the map and the line drawn on it both read this array, so they cannot describe different things.
 *
 * These steps are a hue ramp (blue through green and yellow to red). Measured as a magnitude ramp
 * it fails on four counts: lightness is not monotone, the slowest and fastest steps land at almost
 * the same lightness (0.558 against 0.551, indistinguishable in greyscale or with severe colour
 * blindness), four middle steps sit within 0.025 of each other, and the yellow step is 1.55:1
 * against a pale map tile. A single-hue ramp measured clean on all four:
 *
 *   #d1a5db #bf90ca #ae7aba #9d65a9 #8c5099 #7b3a89 #6a2379 #590369
 *
 * Swapping the two lists is the whole change - nothing else reads the hues.
 */
export const SPEED_RAMP = [
  "#1173d4",
  "#11d4d4",
  "#11d473",
  "#11d411",
  "#73d411",
  "#d4d411",
  "#d47311",
  "#d41111",
] as const;

/**
 * The strongest the elevation profile ever paints a frozen column.
 *
 * Here rather than in the view because the contrast the palette is measured for depends on it: the
 * shading is never seen at full strength, so the guard has to composite at exactly the value that
 * ships. Raising this past 0.59 drops the dark theme's trace-on-shading below the 3:1 floor.
 */
export const MAX_FROZEN_OPACITY = 0.55;

export function bandColour(band: number): string {
  const index = Math.min(Math.max(Math.round(band), 0), SPEED_RAMP.length - 1);
  return SPEED_RAMP[index];
}

export interface BandSpeedBounds {
  fromKt: number;
  toKt: number;
}

/**
 * The speed each band stands for, in knots.
 *
 * Bands are relative to the fastest point of the flight being viewed, not to an absolute speed, so
 * the legend has to be computed per flight. Printing one fixed scale under a relative ramp would
 * state something that is not true of the picture above it.
 */
export function bandSpeedBoundsKt(maxSpeedMps: number): BandSpeedBounds[] {
  const maxKt = toKnots(Math.max(maxSpeedMps, 0));
  const step = maxKt / SPEED_RAMP.length;

  return SPEED_RAMP.map((_, band) => ({
    fromKt: Math.round(step * band),
    toKt: Math.round(step * (band + 1)),
  }));
}

export function cssVariables(palette: Palette): string {
  return (Object.keys(palette) as Array<keyof Palette>)
    .map((token) => `--${token}: ${palette[token]};`)
    .join("\n    ");
}
