/**
 * The units an aircraft is flown in, as conversions rather than as factors sprinkled through the
 * views.
 *
 * Stated from their definitions and not from rounded decimals: a nautical mile is exactly 1852
 * metres and a foot exactly 0.3048, so a knot is 1852/3600 m/s rather than 0.5144. The tests assert
 * the definitions, which is only possible if the code states them.
 */

/** Exactly 1852 metres, by international agreement. */
export const METRES_PER_NAUTICAL_MILE = 1852;

/** Exactly 0.3048 metres, by international agreement. */
export const METRES_PER_FOOT = 0.3048;

/** One nautical mile per hour. */
export const METRES_PER_SECOND_PER_KNOT = METRES_PER_NAUTICAL_MILE / 3600;

/**
 * The one definition of a knot in this codebase. The inline client script converts speed for its
 * own readout, and it is handed this value rather than a literal of its own.
 */
export const KNOTS_PER_MPS = 1 / METRES_PER_SECOND_PER_KNOT;

export function toKnots(metresPerSecond: number): number {
  return metresPerSecond * KNOTS_PER_MPS;
}

export function toFeet(metres: number): number {
  return metres / METRES_PER_FOOT;
}

export function toNauticalMiles(metres: number): number {
  return metres / METRES_PER_NAUTICAL_MILE;
}

/** Whole knots. A decimal would imply a precision the receiver does not have. */
export function formatKnots(metresPerSecond: number): string {
  return `${Math.round(toKnots(metresPerSecond))} kt`;
}

/**
 * Whole feet, and deliberately NOT rounded to the nearest 10 or 20 ft the way an altimeter face
 * reads. That rounding would hide the 0.1 m quantisation the elevation profile exists to show.
 */
export function formatFeet(metres: number): string {
  return `${Math.round(toFeet(metres))} ft`;
}

export function formatNauticalMiles(metres: number): string {
  return `${toNauticalMiles(metres).toFixed(1)} NM`;
}
