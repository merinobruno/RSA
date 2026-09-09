import { getPool } from "./pool";
import {
  findSegmentContaining,
  segmentStream,
  trackDistanceMetres,
  type FlightSegment,
  type StreamPoint,
} from "../services/flightSegmentation";
import { trackShape, type ShapePoint } from "../services/trackShape";

/** Enough vertices to recognise a circuit from a cross-country at glyph size, and no more. */
const SHAPE_POINTS = 32;

/**
 * Flights, derived from the telemetry stream rather than stored.
 *
 * There is no `flights` table on purpose. A materialised summary of rows that keep arriving - the
 * offline queue can deliver a packet an hour after capture - is a second copy of a fact that can
 * drift from the first, silently. Deriving it on read means the answer is always consistent with
 * the telemetry it describes.
 *
 * The segmentation itself runs in TypeScript, not SQL. An earlier version did it with window
 * functions, which was elegant while the only rule was "split on a gap"; once flights also had to
 * be split by stationary runs and dropped when they never moved, expressing it in SQL meant a
 * second, harder-to-test copy of a rule that already exists as a tested pure function. One
 * implementation, exercised directly by unit tests, is worth the cost of reading two columns.
 *
 * Only `captured_at` and `speed_mps` are read to segment - the full track is fetched for one
 * flight at a time, when someone actually opens it.
 */

export interface FlightSummary {
  deviceId: string;
  deviceLabel: string;
  startedAt: Date;
  endedAt: Date;
  packetCount: number;
  maxSpeedMps: number;
  /** Summed along the track. One definition, so the index and the flight page cannot disagree. */
  distanceM: number;
  /** The track reduced to a drawable outline in a unit box. Empty below two fixes. */
  shape: ShapePoint[];
}

/**
 * A registered device and when it was last heard from.
 *
 * Separate from flights on purpose: a phone whose background service was killed reports nothing at
 * all, so it has no flight to appear in and would be invisible on a page that only lists flights.
 * That failure mode is this project's known unfixable risk, and silence is the only symptom.
 */
export interface DeviceStatus {
  deviceId: string;
  deviceLabel: string;
  lastSeenAt: Date | null;
}

export interface TrackPoint {
  capturedAt: Date;
  lat: number;
  lon: number;
  altitudeM: number;
  gpsAccuracyM: number;
  speedMps: number;
  headingDeg: number;
  batteryPct: number;
}

interface SegmentMetrics {
  maxSpeedMps: number;
  distanceM: number;
  shape: ShapePoint[];
}

interface DeviceStream {
  deviceId: string;
  deviceLabel: string;
  points: StreamPoint[];
  metricsIn: (segment: FlightSegment) => SegmentMetrics;
}

async function loadStreams(deviceId?: string): Promise<DeviceStream[]> {
  const { rows } = await getPool().query<{
    device_id: string;
    device_label: string;
    captured_at: Date;
    speed_mps: number;
    lat: number;
    lon: number;
  }>(
    `SELECT t.device_id, d.label AS device_label, t.captured_at, t.speed_mps, t.lat, t.lon
     FROM telemetry t
     JOIN devices d ON d.id = t.device_id
     ${deviceId ? "WHERE t.device_id = $1" : ""}
     ORDER BY t.device_id, t.captured_at ASC`,
    deviceId ? [deviceId] : []
  );

  interface Entry {
    label: string;
    points: StreamPoint[];
    speeds: number[];
    coords: Array<{ lat: number; lon: number }>;
  }

  const byDevice = new Map<string, Entry>();
  for (const row of rows) {
    let entry = byDevice.get(row.device_id);
    if (!entry) {
      entry = { label: row.device_label, points: [], speeds: [], coords: [] };
      byDevice.set(row.device_id, entry);
    }
    entry.points.push({ atMillis: row.captured_at.getTime(), speedMps: Number(row.speed_mps) });
    entry.speeds.push(Number(row.speed_mps));
    entry.coords.push({ lat: Number(row.lat), lon: Number(row.lon) });
  }

  return [...byDevice.entries()].map(([id, entry]) => ({
    deviceId: id,
    deviceLabel: entry.label,
    points: entry.points,
    // One walk of the window for every figure the index needs. Coordinates are read here rather
    // than measured in SQL so that distance stays the one tested implementation in
    // flightSegmentation, for the same reason segmentation itself is not expressed in SQL.
    metricsIn: (segment) => {
      let maxSpeedMps = 0;
      const coords: Array<{ lat: number; lon: number }> = [];

      for (let i = 0; i < entry.points.length; i++) {
        const at = entry.points[i].atMillis;
        if (at < segment.startedAtMillis) continue;
        if (at > segment.endedAtMillis) break;
        if (entry.speeds[i] > maxSpeedMps) maxSpeedMps = entry.speeds[i];
        coords.push(entry.coords[i]);
      }

      return {
        maxSpeedMps,
        distanceM: trackDistanceMetres(coords),
        shape: trackShape(coords, SHAPE_POINTS),
      };
    },
  }));
}

function toSummary(stream: DeviceStream, segment: FlightSegment): FlightSummary {
  const metrics = stream.metricsIn(segment);

  return {
    deviceId: stream.deviceId,
    deviceLabel: stream.deviceLabel,
    startedAt: new Date(segment.startedAtMillis),
    endedAt: new Date(segment.endedAtMillis),
    packetCount: segment.packetCount,
    maxSpeedMps: metrics.maxSpeedMps,
    distanceM: metrics.distanceM,
    shape: metrics.shape,
  };
}

/**
 * Every registered device with its last packet, including devices that have never sent one.
 *
 * A LEFT JOIN rather than a scan of telemetry: the whole point is to surface a device that is
 * silent, and a silent device has no telemetry rows to be found in.
 */
export async function listDeviceStatus(): Promise<DeviceStatus[]> {
  const { rows } = await getPool().query<{
    id: string;
    label: string;
    last_seen: Date | null;
  }>(
    // The last capture and nothing else. An earlier version also counted packets per device, which
    // no caller ever read and which is the expensive half of this query: a count has to touch every
    // row, while the maximum is the last entry of the (device_id, captured_at) index.
    `SELECT d.id,
            d.label,
            (SELECT MAX(t.captured_at) FROM telemetry t WHERE t.device_id = d.id) AS last_seen
     FROM devices d
     ORDER BY d.label ASC`
  );

  return rows.map((r) => ({
    deviceId: r.id,
    deviceLabel: r.label,
    lastSeenAt: r.last_seen,
  }));
}

/** Every flight across every device, newest first. */
export async function listFlights(): Promise<FlightSummary[]> {
  const streams = await loadStreams();

  return streams
    .flatMap((stream) => segmentStream(stream.points).map((s) => toSummary(stream, s)))
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}

/** The flight of [deviceId] containing [instant], or null. */
export async function findFlight(deviceId: string, instant: Date): Promise<FlightSummary | null> {
  const [stream] = await loadStreams(deviceId);
  if (!stream) return null;

  const segment = findSegmentContaining(segmentStream(stream.points), instant.getTime());
  return segment ? toSummary(stream, segment) : null;
}

/** Every point of one flight, in order. */
export async function findTrack(
  deviceId: string,
  startedAt: Date,
  endedAt: Date
): Promise<TrackPoint[]> {
  const { rows } = await getPool().query<{
    captured_at: Date;
    lat: number;
    lon: number;
    altitude_m: number;
    gps_accuracy_m: number;
    speed_mps: number;
    heading_deg: number;
    battery_pct: number;
  }>(
    `SELECT captured_at, lat, lon, altitude_m, gps_accuracy_m, speed_mps, heading_deg, battery_pct
     FROM telemetry
     WHERE device_id = $1 AND captured_at BETWEEN $2 AND $3
     ORDER BY captured_at ASC`,
    [deviceId, startedAt.toISOString(), endedAt.toISOString()]
  );

  return rows.map((r) => ({
    capturedAt: r.captured_at,
    lat: Number(r.lat),
    lon: Number(r.lon),
    altitudeM: Number(r.altitude_m),
    gpsAccuracyM: Number(r.gps_accuracy_m),
    speedMps: Number(r.speed_mps),
    headingDeg: Number(r.heading_deg),
    batteryPct: Number(r.battery_pct),
  }));
}
