import { getPool } from "./pool";
import {
  findSegmentContaining,
  segmentStream,
  type FlightSegment,
  type StreamPoint,
} from "../services/flightSegmentation";

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

interface DeviceStream {
  deviceId: string;
  deviceLabel: string;
  points: StreamPoint[];
  maxSpeedIn: (segment: FlightSegment) => number;
}

async function loadStreams(deviceId?: string): Promise<DeviceStream[]> {
  const { rows } = await getPool().query<{
    device_id: string;
    device_label: string;
    captured_at: Date;
    speed_mps: number;
  }>(
    `SELECT t.device_id, d.label AS device_label, t.captured_at, t.speed_mps
     FROM telemetry t
     JOIN devices d ON d.id = t.device_id
     ${deviceId ? "WHERE t.device_id = $1" : ""}
     ORDER BY t.device_id, t.captured_at ASC`,
    deviceId ? [deviceId] : []
  );

  const byDevice = new Map<string, { label: string; points: StreamPoint[]; speeds: number[] }>();
  for (const row of rows) {
    let entry = byDevice.get(row.device_id);
    if (!entry) {
      entry = { label: row.device_label, points: [], speeds: [] };
      byDevice.set(row.device_id, entry);
    }
    entry.points.push({ atMillis: row.captured_at.getTime(), speedMps: Number(row.speed_mps) });
    entry.speeds.push(Number(row.speed_mps));
  }

  return [...byDevice.entries()].map(([id, entry]) => ({
    deviceId: id,
    deviceLabel: entry.label,
    points: entry.points,
    maxSpeedIn: (segment) => {
      let max = 0;
      for (let i = 0; i < entry.points.length; i++) {
        const at = entry.points[i].atMillis;
        if (at < segment.startedAtMillis) continue;
        if (at > segment.endedAtMillis) break;
        if (entry.speeds[i] > max) max = entry.speeds[i];
      }
      return max;
    },
  }));
}

function toSummary(stream: DeviceStream, segment: FlightSegment): FlightSummary {
  return {
    deviceId: stream.deviceId,
    deviceLabel: stream.deviceLabel,
    startedAt: new Date(segment.startedAtMillis),
    endedAt: new Date(segment.endedAtMillis),
    packetCount: segment.packetCount,
    maxSpeedMps: stream.maxSpeedIn(segment),
  };
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
