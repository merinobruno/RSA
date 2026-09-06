import { createApp } from "./app";
import { config } from "./config";
import { closePool } from "./db/pool";

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`Telemetry server listening on port ${config.port}`);
});

async function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down...`);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
