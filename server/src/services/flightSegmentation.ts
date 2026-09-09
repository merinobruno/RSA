/**
 * Carving flights out of a continuous telemetry stream.
 *
 * A device does not report "flights" - it reports a packet a second for as long as tracking is on.
 * A flight is therefore not something the system is told; it is inferred from the shape of the
 * stream. Two things end one:
 *
 * 1. **A gap in the data** longer than [DATA_GAP_MILLIS] - tracking was switched off.
 * 2. **A stationary stretch** longer than [STATIONARY_SPLIT_MILLIS] - the aircraft is parked, and
 *    those points are dropped rather than kept as part of either flight.
 *
 * Rule 2 was not in the first design and was added because rule 1 alone failed on real data: a
 * phone left capturing all day produced one "flight" of 14.6 hours, because its idle gaps never
 * exceeded fifteen minutes. With both rules the same data yields six outings of 14 to 162 minutes,
 * which is what actually happened.
 *
 * A first attempt at rule 2 split *at* each stationary point and produced 62 flights of exactly
 * fifteen minutes: it sliced the parked period instead of removing it. The distinction matters -
 * a stationary run is a separator to be discarded, not a boundary to cut on repeatedly.
 *
 * Thresholds are deliberately generous about what counts as still in flight. [MOVING_SPEED_MPS] is
 * 2 m/s (7 km/h), below any aircraft's groundspeed including a glider circling in weak lift, and
 * ten minutes motionless is longer than a run-up and hold but shorter than a stop for fuel.
 *
 * Pure: no database, no Express, no clock. Every function here is a function of its arguments.
 */

/** Tracking was switched off. */
export const DATA_GAP_MILLIS = 15 * 60 * 1000;

/** Motionless for this long ends a flight, and the motionless points are discarded. */
export const STATIONARY_SPLIT_MILLIS = 10 * 60 * 1000;

/** Below this, the aircraft is treated as not moving. 2 m/s is 7 km/h. */
export const MOVING_SPEED_MPS = 2;

/**
 * How stale a flight's last packet may be and still read as in progress.
 *
 * Deliberately far tighter than [DATA_GAP_MILLIS], which answers a different question - whether
 * tracking was ever switched off - rather than whether something is happening right now. At 1 Hz
 * capture with a 30 second upload interval a packet should land within a minute; two minutes
 * tolerates one missed cycle.
 *
 * This can only ever report what arrived. A phone inside a coverage hole is still flying and not
 * reporting, and its packets will turn up later from the queue - so a surface built on this states
 * the age of the last packet rather than claiming the aircraft has landed.
 */
export const LIVE_STALENESS_MILLIS = 2 * 60 * 1000;

/** Whether a flight whose last packet landed at [lastPacketAtMillis] is still running. */
export function isInProgress(lastPacketAtMillis: number, nowMillis: number): boolean {
  return nowMillis - lastPacketAtMillis <= LIVE_STALENESS_MILLIS;
}

export interface StreamPoint {
  atMillis: number;
  speedMps: number;
}

export interface FlightSegment {
  startedAtMillis: number;
  endedAtMillis: number;
  packetCount: number;
}

/**
 * Splits an ascending stream into flights.
 *
 * A run that never exceeded [MOVING_SPEED_MPS] is not a flight and is dropped entirely: a phone
 * sitting on a table for nine hours should produce nothing, not an entry.
 */
export function segmentStream(
  points: readonly StreamPoint[],
  options: { dataGapMillis?: number; stationarySplitMillis?: number; movingSpeedMps?: number } = {}
): FlightSegment[] {
  const dataGap = options.dataGapMillis ?? DATA_GAP_MILLIS;
  const stationarySplit = options.stationarySplitMillis ?? STATIONARY_SPLIT_MILLIS;
  const movingSpeed = options.movingSpeedMps ?? MOVING_SPEED_MPS;

  if (points.length === 0) return [];

  const flights: FlightSegment[] = [];
  let current: StreamPoint[] = [];
  let stationarySince: number | null = null;

  const close = () => {
    if (current.length > 1 && current.some((p) => p.speedMps > movingSpeed)) {
      flights.push({
        startedAtMillis: current[0].atMillis,
        endedAtMillis: current[current.length - 1].atMillis,
        packetCount: current.length,
      });
    }
    current = [];
  };

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const previous = points[i - 1];

    if (previous && point.atMillis - previous.atMillis > dataGap) {
      close();
      stationarySince = null;
    }

    if (point.speedMps > movingSpeed) {
      stationarySince = null;
      current.push(point);
      continue;
    }

    if (stationarySince === null) stationarySince = point.atMillis;

    if (point.atMillis - stationarySince > stationarySplit) {
      // Long enough to be parked rather than paused. End the flight here and drop this point;
      // resetting the marker to now is what keeps a long stop from being sliced into pieces.
      close();
      stationarySince = point.atMillis;
      continue;
    }

    current.push(point);
  }

  close();
  return flights;
}

/**
 * Finds the flight containing [instantMillis], or null.
 *
 * Containing, not starting at: a packet held in the phone's offline queue can arrive an hour late -
 * one was measured arriving 62 minutes after capture - and shift a flight's boundaries. A link
 * that rotted the first time the queue drained would be a link not worth sharing.
 */
export function findSegmentContaining(
  segments: readonly FlightSegment[],
  instantMillis: number
): FlightSegment | null {
  return (
    segments.find((s) => instantMillis >= s.startedAtMillis && instantMillis <= s.endedAtMillis) ??
    null
  );
}

/** Straight-line metres between two fixes. Adequate for a track sampled at 1 Hz. */
export function metresBetween(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const dLat = (b.lat - a.lat) * 111320;
  const dLon = (b.lon - a.lon) * 111320 * Math.cos((b.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/** Summed segment lengths along a track, in metres. */
export function trackDistanceMetres(points: ReadonlyArray<{ lat: number; lon: number }>): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += metresBetween(points[i - 1], points[i]);
  return total;
}
