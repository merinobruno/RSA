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

**Settled by real flight data on 2026-09-12, and the answer is "it depends on
the regime".** Read this before changing any surface that shows an elevation.

Development ran for months on ground data that said the value was worthless: it
appeared to arrive in 0.1 m steps, was bit-identical across two different phones
at the same place, and did not change across 63% of consecutive stationary fixes
while the receiver declared ±15 m. That reads as a terrain-model lookup rather
than a GNSS vertical solution, and the dashboard was built to withhold trust
accordingly.

Every one of those observations was gathered on the ground, where a terrain
lookup and a real measurement are the same number by construction. The
discriminator the design named — does the trace follow a climb or stay at field
elevation — was then run against a real flight: a skydive out of Allen, 1,798
fixes, 2,931 m of vertical range.

| Regime | Fixes repeating the previous value | Mean declared accuracy |
|---|---|---|
| Above 2,000 m | 2.0% | 6 m |
| 1,000–2,000 m | 0.6% | 5 m |
| 500–1,000 m | 1.0% | 5 m |
| Below 500 m | 30.8% | 33 m |
| Stationary on the ground | 63% | ±15 m |

**In flight the elevation is a real GNSS measurement.** It tracked the climb
from 274 m to 3,205 m, changing every second, and the altitude steps in that
data are 0.01 m across 497 distinct sizes — the 0.1 m quantisation reported from
ground testing does not appear at all. The original suspicion was correct about
ground data and wrong as a claim about the sensor.

Three caveats survive and are permanent:

- It is height above the **WGS84 ellipsoid**, not above mean sea level and not
  pressure altitude. In this region that is roughly a 15 m offset, uncorrected.
- **Near the ground it degrades badly** and holds its last value, which is what
  the frozen-sample shading on the profile marks.
- **It can vanish entirely.** During the jump the receiver lost lock for about
  100 seconds and reported field elevation with 2,351 m of declared error, which
  renders as a step no aircraft could fly.

**The honesty commitment is unchanged in kind, only in content.** A surface that
claims more than the data supports has failed — and as of this flight, so has
one that claims less. The elevation is still rendered in `warnInk` because it is
the one figure whose worth is conditional, not because it is junk.

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

**Barometric altitude, declined 2026-09-09.** A pressure sensor
(`Sensor.TYPE_PRESSURE`) would be the honest altitude source — absolute, free of
drift, indifferent to the phone's orientation, and the same quantity an aircraft
altimeter reads — and it was raised for exactly that reason. The operator
declined it on hardware grounds: barometers are common in flagship phones and
uncommon in the cheap ones this fleet is built on, so designing around a sensor
most of the fleet will not have buys nothing. **GPS elevation, as it comes, is
the decision.**

The consequence is not a gap to fill later but a constraint already honoured:
the elevation is shown with its own evidence attached rather than trusted, and
the only remaining way to learn what the value is worth is the shape of the
profile on a real flight — whether the trace follows a climb or stays at field
elevation. Do not re-propose the barometer without new hardware.

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
