# Flight dashboard — design

Date: 2026-09-07
Status: approved

## Why

Phase one of this project deliberately stopped at "app + server". The map was
always the second stage, and phase one is now proven in the field: 1,338 packets
over a 223 km ride, an offline queue that survived a 62-minute signal gap, and
capture running at 1 Hz.

This is that second stage: somewhere to look at a flight once it is over.

## Decisions

**Post-flight review, not live tracking.** No WebSockets, no push, no polling —
just queries over data that already exists. Live tracking is explicitly out of
scope.

**Public, no login.** Anyone with the URL sees the tracks. The privacy cost was
raised explicitly — the data shows where the operator lives, and it includes a
third party (Diego) who agreed to test a tracker, not to publish his location
history — and the decision was made knowingly. A `robots.txt` and a `noindex`
meta tag keep it out of search results, which is not access control but costs
nothing.

**A flight is a run of captures with no gap longer than 15 minutes.** The
telemetry is one continuous stream per device — Diego's phone captured 17 hours
straight, stationary overnight included — so a flight has to be carved out of
it. Gaps already occur naturally when tracking is stopped, so nobody has to mark
anything.

Segmentation by movement was rejected: an aircraft holding at the threshold for
clearance would be split into two flights. Segmentation by day was rejected: it
merges two flights on the same day and splits one that crosses midnight.

## Architecture

The dashboard is served by the **existing Express server**. No second service,
no second deployment, no CORS.

That also resolves the read-authorisation problem this feature would otherwise
force. The device API authenticates with a device's own key and returns 403 for
any other device's telemetry — correct for devices, useless for a dashboard that
must read several. Rather than invent a second credential type, **the dashboard
reads the database server-side**. The device API is untouched, and the dashboard
exposes only what it chooses.

```
GET  /                          flight list (HTML)
GET  /flights/:deviceId/:at     one flight (HTML + map)
GET  /api/flights               flight list (JSON)
GET  /api/flights/:deviceId/:at/track   that flight's points (JSON)
```

`:at` is the flight's start as epoch milliseconds. A flight is looked up as
"the segment containing this instant" rather than by exact equality, so a
late-arriving queued packet that shifts a boundary cannot break a shared link.

## Components

- **`services/flightSegmentation.ts`** — pure: given ordered timestamps and a
  threshold, produce segments. No database, no Express. Unit tested directly,
  the same way `QueuePolicy` and `RejectionResolver` are.
- **`db/flightRepository.ts`** — the SQL. Boundaries are found with a `LAG`
  window function and grouped with a running `SUM`, so Postgres does the
  segmentation over indexed rows instead of shipping a day of telemetry to Node
  to be sliced. No `flights` table: nothing to materialise means nothing to fall
  out of sync with the telemetry it summarises.
- **`views/`** — plain template functions returning HTML strings. No template
  engine.
- **Leaflet + OpenStreetMap** from a CDN. Free, no API key, no billing account —
  unlike Google Maps. No build step, no bundler, no framework: this is a
  polyline and four numbers.

## What a flight page shows

The track, coloured by speed. Distance, duration, max speed, and start/end times
in GMT-3 — every timestamp a human reads in this system is local, every
timestamp stored is UTC.

**Altitude is shown with an explicit warning that it is not trustworthy.** The
recorded altitude is quantised to 0.1 m steps, was bit-identical across two
different phones at the same place, and did not change at all across 63% of
stationary consecutive fixes while the receiver reported ±15 m accuracy. It
tracks terrain, which is indistinguishable from real altitude on the ground and
wrong the moment an aircraft leaves it. Displaying it silently would repeat
exactly the failure mode this project has spent its effort eliminating.

## Out of scope

Live tracking. User accounts. Naming or editing flights by hand. Any of these
can come later; none is needed to look at a flight that already happened.

## Testing

Segmentation: unit tests, no database — boundary cases (empty, single point,
gap exactly at the threshold, gap one millisecond over).

Routes: integration tests against real Postgres, alongside the existing suite,
which `npm test` already provisions on its own.
