# RSA Telemetry Server

Backend server for the RSA aircraft telemetry tracking system. A cheap Android
phone rides in each aircraft and periodically (every 30s) POSTs a batch of
telemetry packets over HTTPS. This server validates, deduplicates, and stores
those packets, and exposes a read API to query them back. There is no
dashboard/map UI here - that is a separate, future project.

Stack: Node.js + TypeScript, Express, Zod, PostgreSQL (via `pg`, no ORM).

## Requirements

- Node.js 20+ (developed against Node 24)
- A reachable PostgreSQL database (locally installed, Dockerized, or hosted)

## Setup

```bash
npm install
```

### Configure the database connection

This project needs a `.env` file (or real environment variables) with:

```dotenv
# PostgreSQL connection string.
# Format: postgres://<user>:<password>@<host>:<port>/<database>
DATABASE_URL=postgres://postgres:postgres@localhost:5432/rsa_telemetry

# Port the HTTP server listens on.
PORT=3000
```

`server/.env.example` documents exactly this; copy it to `server/.env` and
edit if your database differs.

`PORT` defaults to `3000` if unset. `DATABASE_URL` is required to actually
talk to the database (server start-up itself does not require it - it is
only checked the first time a request needs the database - but every real
request other than `GET /health` does).

### Need a PostgreSQL? Run one with no install

If you do not already have PostgreSQL (or Docker), this starts a real one
using the `embedded-postgres` dev dependency - official PostgreSQL binaries,
no Docker and no admin rights:

```bash
npm run db:dev
```

It listens on the default port `5432` with the credentials in `.env.example`,
so the documented `DATABASE_URL` works as-is. Leave that terminal open;
Ctrl+C stops it. Its data is **persistent**, living in `server/.pgdata`
(gitignored), so registered devices and captured telemetry survive restarts -
unlike the throwaway instance `npm test` spins up.

If you would rather use your own PostgreSQL, ignore this script and just
point `DATABASE_URL` at yours. Nothing else depends on it.

### Run database migrations

```bash
npm run migrate
```

This applies every `.sql` file under `migrations/` in order, tracking what
has already run in a `schema_migrations` table, so it's safe to re-run.
There is currently one migration, `migrations/001_init.sql`, which creates
the `devices` and `telemetry` tables (see [Data model](#data-model)).

### Register a device (aircraft)

There is no admin UI, so a small script registers a device and prints its
API key **once** (only the SHA-256 hash is stored, so save it now):

```bash
npm run seed:device -- "N12345"
```

```
Device registered successfully.
  device_id: 3f2a1c9e-....
  label:     N12345
  api_key:   3f8e2a...   (long random string)

Store the api_key securely now - it cannot be recovered later,
only its hash is stored. Configure the device to send:
  Authorization: Bearer 3f8e2a...
```

Give that `api_key` to the device (or use it for manual testing). The
`label` argument is free text (e.g. the aircraft's tail number) and defaults
to `"Unnamed device"` if omitted.

### Run the server

```bash
npm run dev     # ts-node/tsx style, auto-reload on save
# or
npm run build   # compiles src/ -> dist/ (also acts as a typecheck)
npm start       # runs the compiled dist/index.js
```

## API contract

All request/response bodies are JSON.

### Authentication

Every endpoint requires:

```
Authorization: Bearer <api_key>
```

- Missing or malformed header -> `401 { "error": "..." }`
- API key that doesn't match any registered device -> `401 { "error": "Invalid API key" }`

### `POST /v1/telemetry`

Body: a JSON **array** of telemetry packets (see the exact packet shape
below). An empty array is accepted and simply reports zero of everything.

```json
[
  {
    "packet_id": "5f0a1b8e-9c1f-4a3b-8e2d-6b1f9a2c3d4e",
    "device_id": "11111111-1111-4111-8111-111111111111",
    "captured_at": "2026-09-05T14:32:01.000Z",
    "lat": -34.6037,
    "lon": -58.3816,
    "altitude_m": 1200.5,
    "gps_accuracy_m": 8.2,
    "speed_mps": 42.3,
    "heading_deg": 187.4,
    "acceleration": { "x": 0.12, "y": -0.03, "z": 9.81 },
    "battery_pct": 76
  }
]
```

Field validation:

| Field | Rule |
|---|---|
| `packet_id` | UUID v4, required. Dedupe key together with the authenticated device. |
| `device_id` | UUID, required. Must match the device authenticated via the `Authorization` header (see below). |
| `captured_at` | ISO8601 UTC datetime string ending in `Z` (client capture time, not receipt time). |
| `lat` | number, -90 to 90 |
| `lon` | number, -180 to 180 |
| `altitude_m` | number, >= -1000 (negatives are valid: the client sends WGS84 ellipsoid height, not height above sea level) |
| `gps_accuracy_m` | number, >= 0 |
| `speed_mps` | number, >= 0 |
| `heading_deg` | number, >= 0 and < 360 |
| `acceleration.x/y/z` | numbers, unrestricted |
| `battery_pct` | number, 0 to 100 |

A packet that fails any of these is **rejected individually with a reason**;
the rest of the batch is still processed. A packet whose `device_id` does
not match the device that the `Authorization` header authenticated is also
rejected individually (reason: `device_id (...) does not match the
authenticated device (...)`) - see [Design notes](#design-notes) for why.

A `packet_id` already stored for this device (e.g. the phone retried a batch
after a dropped connection) is **silently deduplicated**: it is not an error,
it is not inserted again, and it is not double-counted. The same applies to
a `packet_id` repeated twice within one request body.

Response: `200`, always (even if every packet was rejected):

```json
{
  "received": 3,
  "accepted": 2,
  "inserted": 1,
  "duplicates": 1,
  "rejected": 1,
  "rejected_packets": [
    { "index": 2, "packet_id": "...", "reason": "lat: lat must be <= 90" }
  ]
}
```

- `received` - number of items in the request array.
- `accepted` - passed validation (whether newly inserted or a duplicate).
- `inserted` - actually written as new rows this call.
- `duplicates` - accepted packets that already existed (`accepted - inserted`); includes both same-batch repeats and cross-request retries.
- `rejected` - failed validation or the device_id ownership check.
- `rejected_packets` - one entry per rejected packet, with its original array `index`, its `packet_id` (when parseable), and a human-readable `reason`. Multiple problems on one packet are joined in `reason` with `; `.

Other error responses:

- Body is not a JSON array -> `400 { "error": "Request body must be a JSON array of telemetry packets." }`
- Malformed JSON syntax -> `400 { "error": "Malformed JSON body." }`

### `GET /v1/devices/:id/telemetry`

Query parameters:

- `since` (optional) - ISO8601 datetime (offset or `Z`, e.g. `2026-09-05T00:00:00Z`). Only rows with `captured_at >= since` are returned.
- `limit` (optional) - positive integer, default `100`, capped at `1000` (a `limit` above 1000 is silently capped, not rejected).

```
GET /v1/devices/11111111-1111-4111-8111-111111111111/telemetry?since=2026-09-05T00:00:00Z&limit=50
Authorization: Bearer <api_key>
```

Response `200`, rows ordered by `captured_at` ascending:

```json
{
  "device_id": "11111111-1111-4111-8111-111111111111",
  "count": 2,
  "telemetry": [
    {
      "packet_id": "5f0a1b8e-9c1f-4a3b-8e2d-6b1f9a2c3d4e",
      "captured_at": "2026-09-05T14:32:01.000Z",
      "lat": -34.6037,
      "lon": -58.3816,
      "altitude_m": 1200.5,
      "gps_accuracy_m": 8.2,
      "speed_mps": 42.3,
      "heading_deg": 187.4,
      "acceleration": { "x": 0.12, "y": -0.03, "z": 9.81 },
      "battery_pct": 76,
      "received_at": "2026-09-05T14:32:03.512Z"
    }
  ]
}
```

Errors:

- `401` - missing/invalid API key (same as above).
- `403` - the authenticated device is not `:id` (a device may only read its own telemetry - see [Design notes](#design-notes)).
- `400` - invalid `since` or `limit`.

### `GET /health`

Not part of the required contract, but included as a near-zero-cost
convenience for deployment health checks: returns `200 { "status": "ok" }`
unconditionally (it does not touch the database).

## Data model

Two tables, see `migrations/001_init.sql`:

- **`devices`**: `id` (uuid pk), `label` (text - e.g. tail number), `api_key_hash` (text, SHA-256 hex of the API key - the plaintext key is never stored), `created_at`.
- **`telemetry`**: `id` (bigserial pk), `device_id` (fk -> devices), `packet_id` (uuid), `captured_at` (timestamptz), `lat`, `lon`, `altitude_m`, `gps_accuracy_m`, `speed_mps`, `heading_deg`, `accel_x`, `accel_y`, `accel_z`, `battery_pct` (all double precision), `received_at` (timestamptz, default now()). Unique constraint on `(device_id, packet_id)` - this is what makes ingestion idempotent at the database level.

## Testing

```bash
npm test
```

There are two kinds of tests:

- **Unit tests** (`test/unit/`) - the Zod packet schema (valid packet
  accepted; every out-of-range/malformed field rejected with a reason
  mentioning that field) and the batch-processing pipeline (schema
  partitioning, the `device_id` ownership check, and the pure,
  DB-free within-batch dedupe logic). These need no database and always run.
- **Integration tests** (`test/integration/`) - exercise `POST
  /v1/telemetry` and `GET /v1/devices/:id/telemetry` against a **real**
  Postgres, including the actual `ON CONFLICT DO NOTHING` dedupe behavior
  at the database level.

`npm test` runs **both**, with no setup step. It goes through
`scripts/with-postgres.mjs`, which:

- uses your `DATABASE_URL` as-is if one is set (CI service container, Docker,
  a local install) and starts nothing; otherwise
- starts a real PostgreSQL from the `embedded-postgres` dev dependency
  (official PostgreSQL binaries, no Docker and no admin rights), runs the
  suite against it, and tears it down afterwards.

The suite applies migrations itself on startup and cleans up its own rows, so
any disposable database works. If port 55432 is taken, set `EMBEDDED_PG_PORT`.

`npm run test:unit` runs vitest directly for a faster loop; the integration
tests skip themselves there when no `DATABASE_URL` is set.

The `embedded-postgres` version is pinned exactly, not caret-ranged: every
release of that package is published as a `-beta`, so an unpinned range would
let an untested prerelease change how the test suite runs.

### Why `npm test` starts a database

The integration suite skips itself when `DATABASE_URL` is missing. That is the
right default for a library, but a trap for a project: the tests that touch
real SQL are exactly the ones that quietly rot when running them is opt-in.
Making the default `npm test` self-sufficient is what keeps them honest.

That is not a hypothetical. The bulk `unnest` INSERT in
`src/db/telemetryRepository.ts` passes each field as its own array, so a
misalignment between the arrays, the column list and the alias list stores
values under the **wrong columns** while still inserting "successfully" - same
row count, same `packet_id`, no error. The GET tests originally compared only
`packet_id`s, so nothing caught that. The
`round-trips every field to the correct column` test now does, and it was
verified by deliberately swapping two arrays in that query: it failed with the
swapped values while all 50 other tests still passed.

## Design notes

A few decisions made while implementing the spec that weren't fully
prescribed by it, called out here so they're easy to find and revisit:

- **A device can only read its own telemetry.** `GET
  /v1/devices/:id/telemetry` returns `403` unless `:id` equals the device
  that the `Authorization` header authenticated. The spec didn't say either
  way; this is the least-privilege default. If a future fleet-wide
  dashboard/reporting service needs to read many devices' telemetry with one
  credential, it will need its own key type (not modeled here) rather than
  reusing a single aircraft's key.
- **A packet's `device_id` must match the authenticated device.** The
  `Authorization` header is the source of truth for which device a batch
  belongs to; the packet's own `device_id` field is cross-checked against it
  and the packet is rejected (not silently overwritten) if they disagree.
  This stops one device's API key from writing rows attributed to a
  different `device_id`.
- **Two-layer dedupe.** Within one request, repeated `packet_id`s are
  collapsed by a pure, unit-tested function (`dedupeWithinBatch` in
  `src/services/telemetryIngest.ts`) before anything is sent to the
  database. Across separate requests (the retry-after-reconnect case this
  server exists for), the `(device_id, packet_id)` unique constraint plus
  `ON CONFLICT DO NOTHING` is the actual source of truth, covered by the
  integration tests.
- **`limit` above 1000 is capped, not rejected**, matching common REST
  pagination conventions; a non-numeric or non-positive `limit` is still a
  `400`.
- **Bigint `telemetry.id`** is returned as-is by `pg` (a string, not a JS
  number) to avoid silent precision loss; it isn't currently exposed in any
  API response anyway (`packet_id` is the public identifier).

## Project layout

```
server/
  migrations/001_init.sql        devices + telemetry tables
  src/
    app.ts                       Express app wiring (routes, JSON parsing, error handling)
    index.ts                     process entry point (listen + graceful shutdown)
    config.ts                    env var loading
    schema/telemetry.ts          Zod packet schema + validatePacket()
    schema/telemetryQuery.ts     Zod schema for GET query params
    schema/zodError.ts           ZodError -> human-readable string
    services/telemetryIngest.ts  pure batch pipeline (validate / ownership-check / dedupe)
    middleware/auth.ts           Bearer API key authentication
    db/pool.ts                   lazy pg Pool
    db/deviceRepository.ts       devices table queries
    db/telemetryRepository.ts    telemetry table queries (bulk insert, range query)
    routes/telemetry.ts          POST /v1/telemetry, GET /v1/devices/:id/telemetry
    scripts/migrate.ts           npm run migrate
    scripts/seedDevice.ts        npm run seed:device
  scripts/
    with-postgres.mjs            dev tooling: guarantees a DB for `npm test`
  test/
    unit/                        schema + dedupe pipeline tests (no DB)
    integration/                 real-Postgres API tests (npm test provides the DB)
```
