/**
 * Groups a track's segments into a handful of speed bands.
 *
 * Not a cosmetic concern. The map used to draw one Leaflet polyline per pair of points, which was
 * survivable at one packet per 30 seconds - a 162 minute flight was ~320 layers - and is not at
 * 1 Hz: the same flight becomes ~9,700 layers, each an element in the DOM registered with the map's
 * event system. Banding turns that into one layer per band whatever the flight's length.
 *
 * The output addresses POINTS, not segments, so the caller can slice its coordinate array directly
 * and adjacent ranges share their boundary point. A range of segments would leave a one-segment
 * hole in the drawn line everywhere the colour changes.
 */

/**
 * Enough steps to read acceleration and descent off the line, few enough that the whole flight is
 * still a handful of layers.
 */
export const SPEED_BAND_COUNT = 8;

export interface SpeedBand {
  /** 0 is the slowest band, `bandCount - 1` the fastest. */
  band: number;
  /** Inclusive point-index ranges, each covering a run of consecutive same-band segments. */
  ranges: Array<[number, number]>;
}

/**
 * Bands are relative to this track's own fastest point rather than to an absolute speed, so a slow
 * circuit still reads as a gradient instead of one flat colour.
 */
export function bandTrack(speedsMps: number[], bandCount: number): SpeedBand[] {
  if (!Number.isInteger(bandCount) || bandCount < 1) {
    throw new Error(`Invalid band count ${bandCount}. It must be a positive integer.`);
  }
  if (speedsMps.length < 2) return [];

  // A loop, not `Math.max(...speeds)`: a long flight at 1 Hz is tens of thousands of points, and
  // spreading that into a call is an argument list the engine is entitled to refuse.
  let fastest = 0;
  for (const speed of speedsMps) {
    if (speed > fastest) fastest = speed;
  }

  const bandOf = (speed: number): number => {
    if (fastest <= 0) return 0;
    const ratio = Math.min(Math.max(speed / fastest, 0), 1);
    return Math.min(Math.floor(ratio * bandCount), bandCount - 1);
  };

  const ranges = new Map<number, Array<[number, number]>>();
  const close = (band: number, from: number, to: number) => {
    const existing = ranges.get(band);
    if (existing) existing.push([from, to]);
    else ranges.set(band, [[from, to]]);
  };

  // Segment `i` runs from point i-1 to point i and takes its band from the speed recorded at its
  // end. Point 0 is only ever a start vertex, so its own speed never selects a band.
  let runBand = bandOf(speedsMps[1]);
  let runStart = 0;
  for (let i = 2; i < speedsMps.length; i++) {
    const band = bandOf(speedsMps[i]);
    if (band === runBand) continue;
    close(runBand, runStart, i - 1);
    runBand = band;
    runStart = i - 1;
  }
  close(runBand, runStart, speedsMps.length - 1);

  return [...ranges.entries()]
    .sort(([a], [b]) => a - b)
    .map(([band, bandRanges]) => ({ band, ranges: bandRanges }));
}
