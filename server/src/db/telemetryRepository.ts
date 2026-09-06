import { getPool } from "./pool";
import type { TelemetryPacket } from "../schema/telemetry";

/**
 * Bulk-inserts a batch of already-validated, already-deduped-within-batch
 * packets for one device. Uses a single `unnest`-based multi-row INSERT with
 * `ON CONFLICT (device_id, packet_id) DO NOTHING` so that a packet_id
 * retried from an earlier request is silently skipped (no duplicate row, no
 * error). Returns the set of packet_ids that were actually newly inserted;
 * any packet in `packets` missing from the returned set already existed.
 */
export async function insertTelemetryBatch(
  deviceId: string,
  packets: TelemetryPacket[]
): Promise<Set<string>> {
  if (packets.length === 0) {
    return new Set();
  }

  const packetIds = packets.map((p) => p.packet_id);
  const capturedAts = packets.map((p) => p.captured_at);
  const lats = packets.map((p) => p.lat);
  const lons = packets.map((p) => p.lon);
  const altitudes = packets.map((p) => p.altitude_m);
  const gpsAccuracies = packets.map((p) => p.gps_accuracy_m);
  const speeds = packets.map((p) => p.speed_mps);
  const headings = packets.map((p) => p.heading_deg);
  const accelXs = packets.map((p) => p.acceleration.x);
  const accelYs = packets.map((p) => p.acceleration.y);
  const accelZs = packets.map((p) => p.acceleration.z);
  const batteryPcts = packets.map((p) => p.battery_pct);

  const result = await getPool().query<{ packet_id: string }>(
    `INSERT INTO telemetry (
       device_id, packet_id, captured_at, lat, lon, altitude_m, gps_accuracy_m,
       speed_mps, heading_deg, accel_x, accel_y, accel_z, battery_pct
     )
     SELECT
       $1::uuid, t.packet_id, t.captured_at, t.lat, t.lon, t.altitude_m, t.gps_accuracy_m,
       t.speed_mps, t.heading_deg, t.accel_x, t.accel_y, t.accel_z, t.battery_pct
     FROM unnest(
       $2::uuid[],              -- packet_id
       $3::timestamptz[],       -- captured_at
       $4::double precision[],  -- lat
       $5::double precision[],  -- lon
       $6::double precision[],  -- altitude_m
       $7::double precision[],  -- gps_accuracy_m
       $8::double precision[],  -- speed_mps
       $9::double precision[],  -- heading_deg
       $10::double precision[], -- accel_x
       $11::double precision[], -- accel_y
       $12::double precision[], -- accel_z
       $13::double precision[]  -- battery_pct
     ) AS t(
       packet_id, captured_at, lat, lon, altitude_m, gps_accuracy_m,
       speed_mps, heading_deg, accel_x, accel_y, accel_z, battery_pct
     )
     ON CONFLICT (device_id, packet_id) DO NOTHING
     RETURNING packet_id`,
    [
      deviceId,
      packetIds,
      capturedAts,
      lats,
      lons,
      altitudes,
      gpsAccuracies,
      speeds,
      headings,
      accelXs,
      accelYs,
      accelZs,
      batteryPcts,
    ]
  );

  return new Set(result.rows.map((r) => r.packet_id));
}

export interface TelemetryApiItem {
  packet_id: string;
  captured_at: string;
  lat: number;
  lon: number;
  altitude_m: number;
  gps_accuracy_m: number;
  speed_mps: number;
  heading_deg: number;
  acceleration: { x: number; y: number; z: number };
  battery_pct: number;
  received_at: string;
}

interface TelemetryRow {
  packet_id: string;
  captured_at: Date;
  lat: number;
  lon: number;
  altitude_m: number;
  gps_accuracy_m: number;
  speed_mps: number;
  heading_deg: number;
  accel_x: number;
  accel_y: number;
  accel_z: number;
  battery_pct: number;
  received_at: Date;
}

function toApiItem(row: TelemetryRow): TelemetryApiItem {
  return {
    packet_id: row.packet_id,
    captured_at: row.captured_at.toISOString(),
    lat: row.lat,
    lon: row.lon,
    altitude_m: row.altitude_m,
    gps_accuracy_m: row.gps_accuracy_m,
    speed_mps: row.speed_mps,
    heading_deg: row.heading_deg,
    acceleration: { x: row.accel_x, y: row.accel_y, z: row.accel_z },
    battery_pct: row.battery_pct,
    received_at: row.received_at.toISOString(),
  };
}

/**
 * Fetches telemetry rows for one device, ordered by captured_at ascending,
 * optionally filtered to captured_at >= since, capped at `limit` rows.
 */
export async function findTelemetryByDevice(
  deviceId: string,
  options: { since?: string; limit: number }
): Promise<TelemetryApiItem[]> {
  const conditions = ["device_id = $1"];
  const params: unknown[] = [deviceId];

  if (options.since) {
    params.push(options.since);
    conditions.push(`captured_at >= $${params.length}`);
  }

  params.push(options.limit);
  const limitParamIndex = params.length;

  const result = await getPool().query<TelemetryRow>(
    `SELECT packet_id, captured_at, lat, lon, altitude_m, gps_accuracy_m, speed_mps,
            heading_deg, accel_x, accel_y, accel_z, battery_pct, received_at
     FROM telemetry
     WHERE ${conditions.join(" AND ")}
     ORDER BY captured_at ASC
     LIMIT $${limitParamIndex}`,
    params
  );

  return result.rows.map(toApiItem);
}
