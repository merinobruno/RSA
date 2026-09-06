import { describe, expect, it } from "vitest";
import { TelemetryPacketSchema, validatePacket } from "../../src/schema/telemetry";
import { makeRawPacket, VALID_PACKET_ID } from "../helpers/fixtures";

describe("TelemetryPacketSchema", () => {
  it("accepts a valid packet", () => {
    const result = TelemetryPacketSchema.safeParse(makeRawPacket());
    expect(result.success).toBe(true);
  });

  it("accepts boundary values (lat/lon extremes, heading 0, battery 0 and 100)", () => {
    const result = TelemetryPacketSchema.safeParse(
      makeRawPacket({ lat: -90, lon: 180, heading_deg: 0, battery_pct: 0, altitude_m: 0 })
    );
    expect(result.success).toBe(true);

    const result2 = TelemetryPacketSchema.safeParse(makeRawPacket({ battery_pct: 100 }));
    expect(result2.success).toBe(true);
  });

  it("accepts negative altitude (WGS84 ellipsoid height, not height above sea level)", () => {
    // The client sends Location.getAltitude() verbatim. Near sea level, and in
    // regions with negative geoid separation, that value is legitimately below
    // zero -- rejecting it would silently drop valid flight data.
    const result = TelemetryPacketSchema.safeParse(makeRawPacket({ altitude_m: -47.3 }));
    expect(result.success).toBe(true);
  });

  it.each([
    ["packet_id", { packet_id: "not-a-uuid" }, "packet_id"],
    ["device_id", { device_id: "not-a-uuid" }, "device_id"],
    ["captured_at (not ISO8601)", { captured_at: "2026-09-05" }, "captured_at"],
    ["captured_at (missing Z)", { captured_at: "2026-09-05T14:32:01.000" }, "captured_at"],
    ["lat too low", { lat: -90.1 }, "lat"],
    ["lat too high", { lat: 90.1 }, "lat"],
    ["lon too low", { lon: -180.1 }, "lon"],
    ["lon too high", { lon: 180.1 }, "lon"],
    ["altitude_m below the garbage floor", { altitude_m: -1000.1 }, "altitude_m"],
    ["gps_accuracy_m negative", { gps_accuracy_m: -1 }, "gps_accuracy_m"],
    ["speed_mps negative", { speed_mps: -1 }, "speed_mps"],
    ["heading_deg negative", { heading_deg: -0.1 }, "heading_deg"],
    ["heading_deg == 360 (exclusive upper bound)", { heading_deg: 360 }, "heading_deg"],
    ["battery_pct negative", { battery_pct: -1 }, "battery_pct"],
    ["battery_pct over 100", { battery_pct: 100.1 }, "battery_pct"],
  ])("rejects invalid %s with a reason mentioning the field", (_name, overrides, expectedField) => {
    const result = TelemetryPacketSchema.safeParse(makeRawPacket(overrides));
    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldPaths = result.error.issues.map((issue) => issue.path.join("."));
      expect(fieldPaths).toContain(expectedField);
    }
  });

  it("rejects a non-numeric acceleration component", () => {
    const result = TelemetryPacketSchema.safeParse(
      makeRawPacket({ acceleration: { x: "not-a-number", y: 0, z: 9.8 } })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path.join("."))).toContain("acceleration.x");
    }
  });

  it("rejects a packet missing a required field", () => {
    const raw = makeRawPacket();
    delete (raw as Record<string, unknown>).lat;
    const result = TelemetryPacketSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it("strips unknown extra fields instead of rejecting the packet", () => {
    const result = TelemetryPacketSchema.safeParse(makeRawPacket({ some_future_field: "x" }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("some_future_field");
    }
  });
});

describe("validatePacket", () => {
  it("returns success with the parsed packet for valid input", () => {
    const result = validatePacket(makeRawPacket(), 0);
    expect(result.success).toBe(true);
    expect(result.packet?.packet_id).toBe(VALID_PACKET_ID);
    expect(result.index).toBe(0);
  });

  it("returns a clear, human-readable reason for an out-of-range field", () => {
    const result = validatePacket(makeRawPacket({ lat: 999 }), 3);
    expect(result.success).toBe(false);
    expect(result.index).toBe(3);
    expect(result.reason).toMatch(/lat/i);
    expect(result.reason).toMatch(/<= 90/);
  });

  it("still extracts packet_id for reporting even when other fields are invalid", () => {
    const result = validatePacket(makeRawPacket({ lat: 999 }), 0);
    expect(result.success).toBe(false);
    expect(result.packetId).toBe(VALID_PACKET_ID);
  });

  it("combines multiple validation failures into one reason string", () => {
    const result = validatePacket(makeRawPacket({ lat: 999, battery_pct: -5 }), 0);
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/lat/);
    expect(result.reason).toMatch(/battery_pct/);
  });

  it("does not throw on completely malformed input (non-object)", () => {
    expect(() => validatePacket("not-an-object", 0)).not.toThrow();
    expect(() => validatePacket(null, 0)).not.toThrow();
    expect(() => validatePacket(42, 0)).not.toThrow();
    const result = validatePacket(null, 0);
    expect(result.success).toBe(false);
  });
});
