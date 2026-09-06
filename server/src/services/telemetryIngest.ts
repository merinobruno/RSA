import { TelemetryPacket, validatePacket } from "../schema/telemetry";

export interface RejectedPacket {
  /** Position of this packet in the original request array. */
  index: number;
  packet_id?: string;
  reason: string;
}

export interface IndexedPacket {
  /** Position of this packet in the original request array. */
  index: number;
  packet: TelemetryPacket;
}

export interface PartitionResult {
  valid: IndexedPacket[];
  rejected: RejectedPacket[];
}

/**
 * Validates every raw item in a batch against the telemetry packet schema.
 * Never throws: each item independently becomes either a valid packet or a
 * rejection with a reason, so one malformed packet never fails the batch.
 */
export function partitionBatch(rawPackets: unknown[]): PartitionResult {
  const valid: IndexedPacket[] = [];
  const rejected: RejectedPacket[] = [];

  rawPackets.forEach((raw, index) => {
    const result = validatePacket(raw, index);
    if (result.success && result.packet) {
      valid.push({ index, packet: result.packet });
    } else {
      rejected.push({
        index,
        packet_id: result.packetId,
        reason: result.reason ?? "Invalid packet",
      });
    }
  });

  return { valid, rejected };
}

/**
 * Rejects packets whose body-declared `device_id` does not match the device
 * that was actually authenticated via the Authorization header. Without this
 * check, a compromised or misconfigured device could write telemetry rows
 * attributed to a different aircraft's device_id.
 */
export function enforceDeviceIdMatch(
  indexedPackets: IndexedPacket[],
  authenticatedDeviceId: string
): PartitionResult {
  const valid: IndexedPacket[] = [];
  const rejected: RejectedPacket[] = [];

  for (const item of indexedPackets) {
    if (item.packet.device_id === authenticatedDeviceId) {
      valid.push(item);
    } else {
      rejected.push({
        index: item.index,
        packet_id: item.packet.packet_id,
        reason: `device_id (${item.packet.device_id}) does not match the authenticated device (${authenticatedDeviceId})`,
      });
    }
  }

  return { valid, rejected };
}

export interface DedupeResult {
  /** First occurrence of each distinct packet_id, in original order. */
  unique: IndexedPacket[];
  /** packet_ids that appeared more than once in this same batch. */
  duplicatePacketIds: string[];
}

/**
 * Pure, DB-free dedupe pass: collapses repeated packet_ids within a single
 * request to their first occurrence. This handles a client that (buggily or
 * defensively) sends the same packet twice in one batch, independent of the
 * database-level (device_id, packet_id) unique constraint that handles
 * duplicates arriving across separate retried requests.
 */
export function dedupeWithinBatch(indexedPackets: IndexedPacket[]): DedupeResult {
  const seen = new Set<string>();
  const unique: IndexedPacket[] = [];
  const duplicatePacketIds: string[] = [];

  for (const item of indexedPackets) {
    if (seen.has(item.packet.packet_id)) {
      duplicatePacketIds.push(item.packet.packet_id);
      continue;
    }
    seen.add(item.packet.packet_id);
    unique.push(item);
  }

  return { unique, duplicatePacketIds };
}

export interface IngestPlan {
  /** Packets to attempt inserting (already deduped within this batch). */
  toInsert: TelemetryPacket[];
  /** Packets that failed validation or the device_id ownership check. */
  rejected: RejectedPacket[];
  /** packet_ids removed by the within-batch dedupe pass. */
  duplicateInBatch: string[];
}

/**
 * Full pure pipeline from a raw request body to an insert plan:
 * schema validation -> device_id ownership check -> within-batch dedupe.
 * Contains no I/O, so it can be unit tested without a database.
 */
export function buildIngestPlan(rawPackets: unknown[], authenticatedDeviceId: string): IngestPlan {
  const { valid: schemaValid, rejected: schemaRejected } = partitionBatch(rawPackets);
  const { valid: ownershipValid, rejected: ownershipRejected } = enforceDeviceIdMatch(
    schemaValid,
    authenticatedDeviceId
  );
  const { unique, duplicatePacketIds } = dedupeWithinBatch(ownershipValid);

  return {
    toInsert: unique.map((item) => item.packet),
    rejected: [...schemaRejected, ...ownershipRejected].sort((a, b) => a.index - b.index),
    duplicateInBatch: duplicatePacketIds,
  };
}
