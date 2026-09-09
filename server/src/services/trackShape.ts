/**
 * Reduces a flight's track to a small drawable outline.
 *
 * The flight index shows the shape of each track beside its numbers, because a reader recognises a
 * shape faster than they read a date. That glyph needs a few dozen points, not the tens of
 * thousands a 1 Hz flight records, and it needs them in a unit box rather than in degrees.
 *
 * Longitude degrees are shorter than latitude degrees away from the equator - at this latitude by
 * about a fifth - so the points are converted to local metres before being normalised. Skipping
 * that step would squash every track from here horizontally and make two different flights look
 * alike.
 *
 * Pure: no SVG, no database, no clock. It returns numbers in a unit box; the view decides what to
 * draw with them.
 */

/** Metres per degree of latitude, the same approximation the distance helper uses. */
const METRES_PER_DEGREE = 111320;

/**
 * The smallest span, in metres, that gets normalised to the full box.
 *
 * A flight that circled one field spans a few hundred metres; scaling that to the same box as a
 * 200 km cross-country would make the two read identically. Below this floor the shape is drawn at
 * its true relative size instead, so a tight circuit renders as the small mark it is.
 */
const MINIMUM_SPAN_METRES = 400;

export interface ShapePoint {
  /** 0 at the left edge of the box, 1 at the right. */
  x: number;
  /** 0 at the TOP of the box, 1 at the bottom - SVG's axis, so north is up on screen. */
  y: number;
}

/**
 * Samples and normalises a track into a unit box, aspect preserved and centred.
 *
 * Returns `[]` for anything that has no shape to draw. Sampling is by index and always keeps the
 * first and last fix; it can cut a corner the full track rounds, which is acceptable in a glyph
 * this size and would not be on the map.
 */
export function trackShape(
  points: ReadonlyArray<{ lat: number; lon: number }>,
  maxPoints: number
): ShapePoint[] {
  if (!Number.isInteger(maxPoints) || maxPoints < 2) {
    throw new Error(`Invalid point budget ${maxPoints}. It must be an integer of at least 2.`);
  }
  if (points.length < 2) return [];

  const sampled = sample(points, maxPoints);

  // One cosine for the whole track. Over the distance a flight from here covers, the error in
  // treating longitude's scale as constant is far below one glyph pixel.
  const cosLat = Math.cos((sampled[0].lat * Math.PI) / 180);
  const metres = sampled.map((p) => ({
    x: p.lon * METRES_PER_DEGREE * cosLat,
    y: p.lat * METRES_PER_DEGREE,
  }));

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of metres) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  // One divisor for both axes is what preserves the aspect: scaling each axis to its own extent
  // would stretch a straight north-south leg into a diagonal across the box.
  const span = Math.max(maxX - minX, maxY - minY, MINIMUM_SPAN_METRES);
  const offsetX = (1 - (maxX - minX) / span) / 2;
  const offsetY = (1 - (maxY - minY) / span) / 2;

  return metres.map((p) => ({
    x: round(offsetX + (p.x - minX) / span),
    // Flipped: latitude grows north, SVG's y grows down.
    y: round(1 - (offsetY + (p.y - minY) / span)),
  }));
}

function sample<T>(points: ReadonlyArray<T>, maxPoints: number): T[] {
  const step = Math.ceil((points.length - 1) / (maxPoints - 1));
  if (step <= 1) return [...points];

  const kept: T[] = [];
  for (let i = 0; i < points.length; i += step) kept.push(points[i]);

  const last = points[points.length - 1];
  if (kept[kept.length - 1] !== last) kept.push(last);
  return kept;
}

/** Three decimals of a unit box is a third of a pixel at any glyph size this page draws. */
function round(value: number): number {
  return Number(value.toFixed(3));
}
