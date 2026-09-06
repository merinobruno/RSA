import { Router } from "express";
import { authenticateDevice } from "../middleware/auth";
import { formatZodError } from "../schema/zodError";
import { TelemetryQuerySchema } from "../schema/telemetryQuery";
import { buildIngestPlan } from "../services/telemetryIngest";
import { insertTelemetryBatch, findTelemetryByDevice } from "../db/telemetryRepository";
import { config } from "../config";

export const telemetryRouter = Router();

telemetryRouter.post("/telemetry", authenticateDevice, async (req, res, next) => {
  try {
    if (!Array.isArray(req.body)) {
      res.status(400).json({
        error: "Request body must be a JSON array of telemetry packets.",
      });
      return;
    }

    // req.device is always set here: authenticateDevice already ran and
    // either attached it or short-circuited the request with a 401.
    const device = req.device as { id: string; label: string };

    const plan = buildIngestPlan(req.body as unknown[], device.id);
    const insertedPacketIds = await insertTelemetryBatch(device.id, plan.toInsert);

    const duplicateAcrossRequests = plan.toInsert.filter(
      (p) => !insertedPacketIds.has(p.packet_id)
    ).length;
    const duplicates = plan.duplicateInBatch.length + duplicateAcrossRequests;
    const accepted = plan.toInsert.length + plan.duplicateInBatch.length;

    res.status(200).json({
      received: req.body.length,
      accepted,
      inserted: insertedPacketIds.size,
      duplicates,
      rejected: plan.rejected.length,
      rejected_packets: plan.rejected.map((r) => ({
        index: r.index,
        packet_id: r.packet_id,
        reason: r.reason,
      })),
    });
  } catch (err) {
    next(err);
  }
});

telemetryRouter.get("/devices/:id/telemetry", authenticateDevice, async (req, res, next) => {
  try {
    const device = req.device as { id: string; label: string };
    const targetDeviceId = req.params.id;

    // A device may only read its own telemetry. This also means a
    // syntactically invalid :id (e.g. not a UUID) can never reach the
    // database query below, since it can never string-equal the
    // authenticated device's real UUID.
    if (device.id !== targetDeviceId) {
      res.status(403).json({
        error: "This API key is not authorized to read telemetry for this device.",
      });
      return;
    }

    const queryResult = TelemetryQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: formatZodError(queryResult.error) });
      return;
    }

    const { since, limit } = queryResult.data;
    const effectiveLimit = Math.min(limit ?? config.telemetry.defaultLimit, config.telemetry.maxLimit);

    const telemetry = await findTelemetryByDevice(targetDeviceId, { since, limit: effectiveLimit });

    res.status(200).json({
      device_id: targetDeviceId,
      count: telemetry.length,
      telemetry,
    });
  } catch (err) {
    next(err);
  }
});
