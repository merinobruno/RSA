import { z } from "zod";
import { formatZodError } from "./zodError";

/**
 * Zod schema for a single telemetry packet, matching the contract sent by the
 * Android client. Every constraint carries a human-readable message so that
 * rejected packets can be reported back with a clear, specific reason.
 */
export const AccelerationSchema = z.object({
  x: z.number("acceleration.x must be a number"),
  y: z.number("acceleration.y must be a number"),
  z: z.number("acceleration.z must be a number"),
});

export const TelemetryPacketSchema = z.object({
  packet_id: z.uuidv4("packet_id must be a valid UUID v4"),

  // Note: this is the device_id claimed by the packet body. The route layer
  // cross-checks it against the authenticated device (derived from the
  // Authorization header) and rejects the packet if they disagree - see
  // src/routes/telemetry.ts.
  device_id: z.uuid("device_id must be a valid UUID"),

  captured_at: z.iso.datetime({
    error:
      "captured_at must be an ISO8601 UTC datetime string with a trailing 'Z' (e.g. 2026-09-05T14:32:01.000Z)",
  }),

  lat: z
    .number("lat must be a number")
    .gte(-90, "lat must be >= -90")
    .lte(90, "lat must be <= 90"),

  lon: z
    .number("lon must be a number")
    .gte(-180, "lon must be >= -180")
    .lte(180, "lon must be <= 180"),

  // Altitude is NOT bounded at zero. The Android client reports
  // Location.getAltitude(), which is height above the WGS84 ellipsoid, not above
  // mean sea level. That is legitimately negative in regions with negative geoid
  // separation, at airfields below sea level, and anywhere near sea level once
  // normal GPS vertical error (typically worse than horizontal) is applied.
  // Rejecting negatives would silently discard valid readings. The floor below
  // only exists to catch garbage, not to constrain real flight.
  altitude_m: z
    .number("altitude_m must be a number")
    .gte(-1000, "altitude_m must be >= -1000"),

  gps_accuracy_m: z
    .number("gps_accuracy_m must be a number")
    .gte(0, "gps_accuracy_m must be >= 0"),

  speed_mps: z.number("speed_mps must be a number").gte(0, "speed_mps must be >= 0"),

  heading_deg: z
    .number("heading_deg must be a number")
    .gte(0, "heading_deg must be >= 0")
    .lt(360, "heading_deg must be < 360"),

  acceleration: AccelerationSchema,

  battery_pct: z
    .number("battery_pct must be a number")
    .gte(0, "battery_pct must be >= 0")
    .lte(100, "battery_pct must be <= 100"),
});

export type TelemetryPacket = z.infer<typeof TelemetryPacketSchema>;

export interface PacketValidationResult {
  index: number;
  success: boolean;
  packet?: TelemetryPacket;
  /** Present when success is false. */
  packetId?: string;
  reason?: string;
}

/**
 * Validates a single raw (unknown-shaped) item from the request body against
 * the telemetry packet contract. Never throws - always returns a result.
 */
export function validatePacket(raw: unknown, index: number): PacketValidationResult {
  const result = TelemetryPacketSchema.safeParse(raw);
  if (result.success) {
    return { index, success: true, packet: result.data };
  }

  // Best-effort extraction of packet_id for error reporting, even though the
  // packet as a whole failed validation (packet_id itself might be valid).
  const rawPacketId =
    typeof raw === "object" && raw !== null && "packet_id" in raw
      ? (raw as Record<string, unknown>).packet_id
      : undefined;

  return {
    index,
    success: false,
    packetId: typeof rawPacketId === "string" ? rawPacketId : undefined,
    reason: formatZodError(result.error),
  };
}
