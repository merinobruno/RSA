import { randomBytes, randomUUID } from "crypto";
import { closePool, getPool } from "../db/pool";
import { hashApiKey } from "../middleware/auth";

/**
 * Registers a new device (e.g. one aircraft) and prints its plaintext API
 * key. This is the ONLY time the plaintext key is ever available - only its
 * SHA-256 hash is stored - so copy it into the device's configuration now.
 *
 * Usage:
 *   npm run seed:device -- "N12345"
 *   (label defaults to "Unnamed device" if omitted)
 */
async function main() {
  const label = process.argv[2] ?? "Unnamed device";
  const id = randomUUID();
  const apiKey = randomBytes(32).toString("base64url");
  const apiKeyHash = hashApiKey(apiKey);

  // The shared pool, not a private one: it is the single place that decides TLS, which a managed
  // database requires. See the note in migrate.ts.
  try {
    await getPool().query(
      "INSERT INTO devices (id, label, api_key_hash) VALUES ($1, $2, $3)",
      [id, label, apiKeyHash]
    );
  } finally {
    await closePool();
  }

  console.log("Device registered successfully.");
  console.log(`  device_id: ${id}`);
  console.log(`  label:     ${label}`);
  console.log(`  api_key:   ${apiKey}`);
  console.log("");
  console.log("Store the api_key securely now - it cannot be recovered later,");
  console.log("only its hash is stored. Configure the device to send:");
  console.log(`  Authorization: Bearer ${apiKey}`);
}

main().catch((err) => {
  console.error("Failed to register device:", err);
  process.exitCode = 1;
});
