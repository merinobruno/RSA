import { z } from "zod";

/**
 * Validates the query string for GET /v1/devices/:id/telemetry.
 * `since` is intentionally more lenient than the packet's `captured_at`
 * (offsets like "+02:00" are accepted, not just "Z") since this is typed by
 * a human or another service, not emitted verbatim by the Android client.
 */
export const TelemetryQuerySchema = z.object({
  since: z
    .iso.datetime({
      offset: true,
      error: "since must be an ISO8601 datetime string (e.g. 2026-09-05T00:00:00Z)",
    })
    .optional(),
  limit: z.coerce
    .number("limit must be a number")
    .int("limit must be an integer")
    .positive("limit must be a positive integer")
    .optional(),
});

export type TelemetryQuery = z.infer<typeof TelemetryQuerySchema>;
