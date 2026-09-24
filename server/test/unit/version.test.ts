import { describe, expect, it } from "vitest";
import request from "supertest";
import { readFileSync } from "fs";
import { join } from "path";
import { createApp } from "../../src/app";

const packageVersion = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8")).version;

describe("program version", () => {
  it("GET /version reports the version in package.json, without authentication", async () => {
    const res = await request(createApp()).get("/version");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ version: packageVersion });
  });
});
