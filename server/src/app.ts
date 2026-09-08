import express, { type ErrorRequestHandler } from "express";
import compression from "compression";
import { telemetryRouter } from "./routes/telemetry";
import { dashboardRouter } from "./routes/dashboard";

export function createApp() {
  const app = express();

  // First, so it covers every response below it. The dashboard inlines a whole flight track in the
  // page - hundreds of kilobytes of coordinates at 1 Hz - and coordinates from one flight share
  // almost all of their leading digits, which is close to the best case for gzip.
  app.use(compression());

  app.use(express.json({ limit: "5mb" }));

  // Not part of the required API contract, but a near-zero-cost convenience
  // for deployment health checks / smoke tests.
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use("/v1", telemetryRouter);

  // Mounted after the device API so a future /v1 route can never be shadowed by a dashboard path,
  // and last before the 404 so the dashboard owns the root without intercepting anything else.
  app.use(dashboardRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    // body-parser (used internally by express.json()) marks JSON parse
    // failures with this `type`, e.g. sending "{not valid json" as the body.
    if (
      err &&
      typeof err === "object" &&
      "type" in err &&
      (err as { type?: string }).type === "entity.parse.failed"
    ) {
      res.status(400).json({ error: "Malformed JSON body." });
      return;
    }

    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  };
  app.use(errorHandler);

  return app;
}
