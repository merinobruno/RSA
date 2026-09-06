import { describe, expect, it } from "vitest";
import {
  buildIngestPlan,
  dedupeWithinBatch,
  enforceDeviceIdMatch,
  partitionBatch,
  type IndexedPacket,
} from "../../src/services/telemetryIngest";
import { TelemetryPacketSchema, type TelemetryPacket } from "../../src/schema/telemetry";
import { makeRawPacket, VALID_DEVICE_ID, OTHER_DEVICE_ID } from "../helpers/fixtures";

/** Test-only helper: build a real, parsed TelemetryPacket from a fixture. */
function parsedPacket(overrides: Record<string, unknown> = {}): TelemetryPacket {
  const result = TelemetryPacketSchema.safeParse(makeRawPacket(overrides));
  if (!result.success) {
    throw new Error("Test fixture produced an invalid packet: " + JSON.stringify(result.error.issues));
  }
  return result.data;
}

function indexed(packet: TelemetryPacket, index = 0): IndexedPacket {
  return { index, packet };
}

describe("partitionBatch", () => {
  it("separates valid and invalid packets and preserves original indices", () => {
    const raw = [makeRawPacket(), makeRawPacket({ lat: 999 }), makeRawPacket()];
    const { valid, rejected } = partitionBatch(raw);

    expect(valid.map((v) => v.index)).toEqual([0, 2]);
    expect(rejected.map((r) => r.index)).toEqual([1]);
    expect(rejected[0].reason).toMatch(/lat/);
  });
});

describe("dedupeWithinBatch (pure, no DB)", () => {
  it("keeps the first occurrence and reports subsequent packet_ids as duplicates", () => {
    const packetA = parsedPacket({ packet_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    const packetB = parsedPacket({ packet_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });

    const input: IndexedPacket[] = [
      indexed(packetA, 0),
      indexed(packetB, 1),
      indexed(packetA, 2), // repeat of A within the same batch
    ];

    const { unique, duplicatePacketIds } = dedupeWithinBatch(input);

    expect(unique.map((u) => u.packet.packet_id)).toEqual([packetA.packet_id, packetB.packet_id]);
    expect(duplicatePacketIds).toEqual([packetA.packet_id]);
  });

  it("returns everything as unique when there are no repeats", () => {
    const packetA = parsedPacket({ packet_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    const packetB = parsedPacket({ packet_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });

    const { unique, duplicatePacketIds } = dedupeWithinBatch([indexed(packetA, 0), indexed(packetB, 1)]);

    expect(unique).toHaveLength(2);
    expect(duplicatePacketIds).toHaveLength(0);
  });

  it("handles an empty batch", () => {
    const { unique, duplicatePacketIds } = dedupeWithinBatch([]);
    expect(unique).toEqual([]);
    expect(duplicatePacketIds).toEqual([]);
  });

  it("collapses three or more repeats of the same packet_id to one", () => {
    const packetA = parsedPacket({ packet_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    const { unique, duplicatePacketIds } = dedupeWithinBatch([
      indexed(packetA, 0),
      indexed(packetA, 1),
      indexed(packetA, 2),
    ]);
    expect(unique).toHaveLength(1);
    expect(duplicatePacketIds).toEqual([packetA.packet_id, packetA.packet_id]);
  });
});

describe("enforceDeviceIdMatch", () => {
  it("accepts packets whose device_id matches the authenticated device", () => {
    const packet = parsedPacket({ device_id: VALID_DEVICE_ID });
    const { valid, rejected } = enforceDeviceIdMatch([indexed(packet, 0)], VALID_DEVICE_ID);
    expect(valid).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("rejects packets whose device_id does not match the authenticated device", () => {
    const packet = parsedPacket({ device_id: OTHER_DEVICE_ID });
    const { valid, rejected } = enforceDeviceIdMatch([indexed(packet, 5)], VALID_DEVICE_ID);
    expect(valid).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].index).toBe(5);
    expect(rejected[0].reason).toMatch(/does not match/);
  });
});

describe("buildIngestPlan (full pure pipeline)", () => {
  it("routes a mix of valid, invalid, mismatched, and duplicate packets correctly", () => {
    const dupId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const raw = [
      makeRawPacket(), // 0: valid
      makeRawPacket({ lat: 999 }), // 1: schema-invalid
      makeRawPacket({ device_id: OTHER_DEVICE_ID }), // 2: valid schema, wrong device
      makeRawPacket({ packet_id: dupId }), // 3: valid, first occurrence of dupId
      makeRawPacket({ packet_id: dupId }), // 4: valid, duplicate of index 3 within batch
    ];

    const plan = buildIngestPlan(raw, VALID_DEVICE_ID);

    // received (5) == accepted + rejected.length, i.e. every packet is
    // accounted for exactly once.
    const accepted = plan.toInsert.length + plan.duplicateInBatch.length;
    expect(accepted + plan.rejected.length).toBe(raw.length);

    expect(plan.toInsert).toHaveLength(2); // packet 0 and the first occurrence of dupId
    expect(plan.duplicateInBatch).toEqual([dupId]);

    expect(plan.rejected.map((r) => r.index)).toEqual([1, 2]);
    expect(plan.rejected[0].reason).toMatch(/lat/);
    expect(plan.rejected[1].reason).toMatch(/does not match/);
  });

  it("returns an empty plan for an empty batch", () => {
    const plan = buildIngestPlan([], VALID_DEVICE_ID);
    expect(plan.toInsert).toEqual([]);
    expect(plan.rejected).toEqual([]);
    expect(plan.duplicateInBatch).toEqual([]);
  });
});
