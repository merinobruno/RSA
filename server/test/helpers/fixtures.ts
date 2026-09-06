/** A syntactically valid UUID v4 (version nibble '4', variant nibble '8'). */
export const VALID_PACKET_ID = "5f0a1b8e-9c1f-4a3b-8e2d-6b1f9a2c3d4e";
export const VALID_DEVICE_ID = "11111111-1111-4111-8111-111111111111";
export const OTHER_DEVICE_ID = "22222222-2222-4222-8222-222222222222";

/** Returns a fresh, contract-valid raw packet object, with optional field overrides. */
export function makeRawPacket(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    packet_id: VALID_PACKET_ID,
    device_id: VALID_DEVICE_ID,
    captured_at: "2026-09-05T14:32:01.000Z",
    lat: -34.6037,
    lon: -58.3816,
    altitude_m: 1200.5,
    gps_accuracy_m: 8.2,
    speed_mps: 42.3,
    heading_deg: 187.4,
    acceleration: { x: 0.12, y: -0.03, z: 9.81 },
    battery_pct: 76,
    ...overrides,
  };
}
