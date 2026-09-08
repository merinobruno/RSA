import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 15000,
    // Applies the schema once, before any file. Doing it per-suite raced once there were two
    // integration suites - see the note in test/globalSetup.ts.
    globalSetup: ["test/globalSetup.ts"],
  },
});
