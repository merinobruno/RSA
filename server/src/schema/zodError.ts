import type { ZodError } from "zod";

/**
 * Flattens a ZodError into one human-readable string, e.g.
 * "lat: lat must be <= 90; acceleration.x: acceleration.x must be a number".
 * Falls back to the bare message when an issue has no path (e.g. the
 * payload itself is not an object).
 */
export function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}
