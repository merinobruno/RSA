# RSA — product context

> Recorded 2026-09-09 from the working codebase, its design documents, and the
> operator's own decisions during development. Where a fact was inferred rather
> than stated, it is labelled **(inferred)**.

## What it is

A fleet telemetry tracker for **general aviation** — avionetas and
ultralivianos. A cheap Android phone rides in each aircraft and posts GPS
position, speed, acceleration, altitude, heading, GPS accuracy and battery
level to a central server. The server ingests it and serves a public,
read-only, post-flight dashboard.

Two deployed parts, one repository:

- `mobile/` — native Kotlin Android app. Captures at 1 Hz, uploads every 30 s,
  queues locally and resends so nothing is lost.
- `server/` — Express + TypeScript on Postgres. Device-authenticated ingestion
  API plus the dashboard. Deployed on Render from `main` with `autoDeploy`.

## The mechanism nobody else has here

It refuses to lose a packet. Rural flight areas lose cellular coverage, so the
client queues locally and resends — a 62-minute signal gap has been survived in
the field with zero loss. Every design decision downstream serves that.

## Who uses it

The operator (this project's author) and pilots flying the fleet's aircraft.
One person reads the dashboard today; the fleet is intended to grow. A third
party, Diego, has tested a tracker in his own vehicle.

## The real scene

Post-flight, indoors, on a laptop or a phone, minutes to hours after landing —
"let me look at the flight I just did". Occasionally mid-flight from the
ground, to check a phone is still reporting. Not a cockpit instrument: nothing
here is flown by.

## Constraints that are physical, not preferences

- **Cheap, low-end phones.** Why the app is native Kotlin rather than
  cross-platform, and why the 30 s upload interval exists at all. The dashboard
  must read well on a small, slow screen.
- **No reliable connectivity.** Anything assuming a live connection contradicts
  the premise.
- **A fleet, not one aircraft.** Every packet identifies its device; the server
  authenticates per device.
- **Free-tier hosting.** Render free web service and free Postgres. The service
  sleeps after ~15 min idle and takes ~1 min to wake.

## Known risk with no software fix

Aggressive OEM battery managers (Xiaomi, Huawei) kill background services.
Mitigation is best-effort — a battery-optimization exemption request plus
manual whitelisting — and needs real-hardware field testing. Never claim this
is verified from a sandbox build.

## What the altitude is worth

The recorded altitude is **not trustworthy**, and the product says so on
screen. It arrives in 0.1 m steps, was bit-identical across two different
phones at the same place, and did not change across 63% of consecutive
stationary fixes while the receiver declared ±15 m. That signature reads as a
terrain-model lookup rather than a GNSS vertical solution.
`Location.getAltitude()` also returns height above the WGS84 ellipsoid, not
mean sea level, so it is not the altitude a pilot reads even when accurate.

All of that evidence was gathered **on the ground**, where a terrain lookup and
a real measurement are the same number by construction — so it is suggestive,
not settled. The dashboard therefore graphs the elevation with the evidence
attached, and the page states plainly that the absence of frozen-sample marks
in flight proves nothing; the discriminator in the air is whether the profile
follows a climb or stays at field elevation.

**This is the product's defining honesty commitment.** Any surface that makes a
number look more authoritative than it is has failed, whatever it looks like.

## Brand commitments

- **Spanish UI**, `<html lang="es">`. Code, identifiers, comments and commit
  messages are English.
- **A single navy identity band** (`#0d2a54`) across both themes — the app's
  identity, not a surface that follows the reader's preference.
- **Light and dark both first-class**, driven by `prefers-color-scheme`, with
  palette contrast asserted by tests rather than eyeballed.
- **Every human-facing timestamp is local (GMT-3, 24-hour); every stored or
  transmitted one is UTC.** One instant, one stored form.
- **Aviation units are primary**: knots, feet, nautical miles. Metric survives
  only as a muted second line on the stat tiles that have one.
- **Labels name the instrument, not the quantity**: GS for ground speed (there
  is no pitot tube), TRK for true track (not magnetic heading), ELEV GPS for
  the WGS84-ellipsoid elevation (never "altitud").

## Deliberately out of scope

Live tracking as infrastructure (no WebSockets, no polling service), user
accounts, iOS, an admin panel for device registration, a user-configurable send
interval, vertical speed, and accelerometer load factor. **(inferred)** Naming
or editing flights by hand.

Knowing whether a flight is *currently in progress* is in scope and is derived
from packet recency, not from a live channel.

## Technical shape worth knowing before designing

- The dashboard is **server-rendered HTML from plain template functions**. No
  template engine, no client bundler, no build step for client JavaScript,
  which lives as an ES5 string literal inside the view and is never
  type-checked.
- **No `flights` table.** Flights are derived on read from the telemetry
  stream: split on a data gap over 15 minutes, split on a stationary stretch
  over 10 minutes with those points discarded, and dropped entirely when the
  run never exceeded 2 m/s.
- The only client dependency is **Leaflet 1.9.4 from unpkg**, plus
  OpenStreetMap tiles. Both pinned with SRI. Adding a third origin is a
  decision, not a detail.
- Colours live as `Palette` tokens in `server/src/views/theme.ts` so their
  contrast can be computed in tests. CSS reads `var(--token)`; no colour is
  stated twice.
