import { createHash } from "crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { findDeviceByApiKeyHash } from "../db/deviceRepository";

// Augment Express's Request type with the authenticated device, attached by
// `authenticateDevice` once the Bearer API key has been verified.
declare global {
  namespace Express {
    interface Request {
      device?: { id: string; label: string };
    }
  }
}

/** SHA-256 hex digest of an API key. Not a high-security KDF, just avoids storing secrets in cleartext. */
export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey, "utf8").digest("hex");
}

const BEARER_PREFIX = "Bearer ";

/**
 * Authenticates a device from the `Authorization: Bearer <api_key>` header.
 * On success, attaches `req.device`. On failure, responds 401 directly
 * (no `next(err)`) since this is an expected, common outcome, not a server
 * error.
 */
export const authenticateDevice: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const header = req.header("Authorization");
  if (!header || !header.startsWith(BEARER_PREFIX)) {
    res.status(401).json({
      error: "Missing or malformed Authorization header. Expected: Bearer <api_key>",
    });
    return;
  }

  const apiKey = header.slice(BEARER_PREFIX.length).trim();
  if (!apiKey) {
    res.status(401).json({ error: "Missing API key" });
    return;
  }

  try {
    const device = await findDeviceByApiKeyHash(hashApiKey(apiKey));
    if (!device) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }
    req.device = { id: device.id, label: device.label };
    next();
  } catch (err) {
    next(err);
  }
};
