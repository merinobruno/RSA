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

/** Speed ramp for the track: blue where the aircraft is slow, red where it is fast. */
export const SLOW_HUE = 210;
export const FAST_HUE = 0;

export function cssVariables(palette: Palette): string {
  return (Object.keys(palette) as Array<keyof Palette>)
    .map((token) => `--${token}: ${palette[token]};`)
    .join("\n    ");
}
