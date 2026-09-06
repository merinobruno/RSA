import { describe, expect, it } from "vitest";
import { sslFor } from "../../src/db/pool";

/**
 * Getting this wrong is not a cosmetic failure. Too strict and a hosted deployment cannot connect
 * at all; too lax against a remote host and the database credentials travel unencrypted.
 */
describe("sslFor", () => {
  const LOCAL = "postgres://postgres:postgres@localhost:5432/rsa_telemetry";
  const REMOTE = "postgres://user:pw@db.example-provider.com:5432/telemetry";

  describe("inferred from the host when DATABASE_SSL is unset", () => {
    it.each([
      "postgres://postgres:postgres@localhost:5432/db",
      "postgres://postgres:postgres@127.0.0.1:5432/db",
      "postgres://postgres:postgres@[::1]:5432/db",
    ])("disables TLS for the local cluster (%s), which does not speak it", (url) => {
      expect(sslFor(url, undefined)).toBe(false);
    });

    it("enables TLS for a remote host", () => {
      expect(sslFor(REMOTE, undefined)).toEqual({ rejectUnauthorized: false });
    });

    it("assumes remote for an unparseable connection string rather than sending credentials in the clear", () => {
      // Failing loudly on a local connection is recoverable; silently skipping TLS on a remote one
      // is not, so the ambiguous case must fail towards encryption.
      expect(sslFor("host=somewhere dbname=telemetry", undefined)).toEqual({ rejectUnauthorized: false });
    });
  });

  describe("explicit DATABASE_SSL overrides the inference", () => {
    it("off disables TLS even for a remote host", () => {
      expect(sslFor(REMOTE, "off")).toBe(false);
    });

    it("require encrypts without verifying the certificate", () => {
      expect(sslFor(LOCAL, "require")).toEqual({ rejectUnauthorized: false });
    });

    it("strict encrypts and verifies the certificate", () => {
      expect(sslFor(LOCAL, "strict")).toEqual({ rejectUnauthorized: true });
    });

    it("is case- and whitespace-insensitive", () => {
      expect(sslFor(REMOTE, "  STRICT  ")).toEqual({ rejectUnauthorized: true });
    });

    it("rejects an unrecognised value instead of quietly falling back", () => {
      // A typo like DATABASE_SSL=true must not silently resolve to some default; the operator
      // needs to know their setting did nothing.
      expect(() => sslFor(REMOTE, "true")).toThrow(/Invalid DATABASE_SSL/);
    });
  });
});
