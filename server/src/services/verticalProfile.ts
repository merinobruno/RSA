/**
 * Reduces a flight's elevation samples to a fixed number of columns for the vertical profile.
 *
 * Pure, like [flightSegmentation] and [trackBanding]: no SVG, no Express, no database. The two
 * rules that carry the meaning - what counts as a frozen sample, and how a coverage gap renders -
 * are the ones easiest to get quietly wrong, so they are testable without rendering anything.
 */

import { toFeet } from "./units";

/**
 * The smallest span the y axis will ever draw, in feet.
 *
 * Roughly twice the +/-15 m the receiver declares. Autoscaling to the observed range alone is a
 * trap this data walks straight into: a road-bound track can span 0.3 m of recorded elevation, and
 * scaling to that turns 10 cm of quantisation into a mountain range. Below the instrument's own
 * error budget, flat is the honest picture.
 */
export const MINIMUM_SPAN_FT = 100;

export interface ProfileSample {
  capturedAt: Date;
  altitudeM: number;
}

export interface ProfileColumn {
  /** 0-based index, which is also this column's x coordinate in the SVG's viewBox. */
  x: number;
  /** The lowest and highest elevation in this column, in feet. Both 0 when it holds nothing. */
  minFt: number;
  maxFt: number;
  /**
   * How much of this column repeated the previous sample exactly, 0 to 1.
   *
   * Not a boolean. A threshold like "shade when over half the samples repeat" would be a number
   * invented here rather than one the data states; the fraction is what was actually observed.
   */
  frozenFraction: number;
  /** 0 where a coverage gap left this column with nothing in it. */
  sampleCount: number;
}

export interface ProfileScale {
  minFt: number;
  maxFt: number;
}

export function profileColumns(samples: ProfileSample[], columnCount: number): ProfileColumn[] {
  if (!Number.isInteger(columnCount) || columnCount < 1) {
    throw new Error(`Invalid column count ${columnCount}. It must be a positive integer.`);
  }
  if (samples.length < 2) return [];

  // A ceiling, not a target: 720 columns over a 90 second flight would be 630 empty ones.
  const columns = Math.min(columnCount, samples.length);

  const startMs = samples[0].capturedAt.getTime();
  const endMs = samples[samples.length - 1].capturedAt.getTime();
  // At least 1, so a stream whose samples all share an instant still divides.
  const span = Math.max(endMs - startMs, 1);

  const buckets = Array.from({ length: columns }, () => ({
    min: Infinity,
    max: -Infinity,
    frozen: 0,
    compared: 0,
    total: 0,
  }));

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];

    // Bucketed by elapsed time rather than by index. The offline queue makes the two diverge
    // whenever coverage drops, and a gap has to stay a gap instead of compressing into a stripe.
    const ratio = (sample.capturedAt.getTime() - startMs) / span;
    const bucket = buckets[Math.min(Math.floor(ratio * columns), columns - 1)];

    const ft = toFeet(sample.altitudeM);
    if (ft < bucket.min) bucket.min = ft;
    if (ft > bucket.max) bucket.max = ft;
    bucket.total++;

    // The first sample of the flight has no predecessor, so it is neither frozen nor not-frozen.
    // Counting it either way would make the first column state something it cannot know.
    if (i > 0) {
      bucket.compared++;
      if (sample.altitudeM === samples[i - 1].altitudeM) bucket.frozen++;
    }
  }

  return buckets.map((bucket, x) => ({
    x,
    minFt: bucket.total > 0 ? bucket.min : 0,
    maxFt: bucket.total > 0 ? bucket.max : 0,
    frozenFraction: bucket.compared > 0 ? bucket.frozen / bucket.compared : 0,
    sampleCount: bucket.total,
  }));
}

export function profileScale(columns: ProfileColumn[]): ProfileScale {
  let min = Infinity;
  let max = -Infinity;
  for (const column of columns) {
    if (column.sampleCount === 0) continue;
    if (column.minFt < min) min = column.minFt;
    if (column.maxFt > max) max = column.maxFt;
  }

  if (min === Infinity) return { minFt: 0, maxFt: MINIMUM_SPAN_FT };
  if (max - min >= MINIMUM_SPAN_FT) return { minFt: min, maxFt: max };

  // Padded around the observed midpoint rather than anchored at the minimum. Anchoring would drop
  // a flat track to the floor of the frame, where it reads as "low" instead of as "unchanging".
  const midpoint = (min + max) / 2;
  return { minFt: midpoint - MINIMUM_SPAN_FT / 2, maxFt: midpoint + MINIMUM_SPAN_FT / 2 };
}
