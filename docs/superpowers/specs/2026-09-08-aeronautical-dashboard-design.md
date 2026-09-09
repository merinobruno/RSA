# Aeronautical dashboard — design

Date: 2026-09-08
Status: approved

## Why

The dashboard shipped on 2026-09-07 reads like a GPS track viewer, not like a
flight log. Distances in kilometres, speed in km/h, timestamps in local time, a
track coloured by speed — and no vertical dimension at all. The operator flies
general aviation and reads instruments in knots and feet.

Altitude was the gap named explicitly. The previous design refused to graph it,
and the page still says so in as many words: `Por eso no se grafica.`

**That refusal was correct on its evidence, and it is reversed here on purpose.**

The evidence is real. The recorded value arrives in 0.1 m steps, was
bit-identical across two different phones at the same place, and did not change
across 63% of consecutive stationary fixes while the receiver declared ±15 m.
That signature is not a GNSS vertical solution — a real one wanders 20–30 m
continuously. It looks like a lookup against a terrain model.
`Location.getAltitude()` also returns height above the WGS84 ellipsoid, not
above mean sea level, so it is not the altitude a pilot reads even when it is
accurate.

But every one of those observations was collected **on the ground**: 1,338
packets over a 223 km road trip. On the ground, "follows the terrain" and "real
altitude" are the same number by construction. The test that disqualified
altitude is the one test that cannot distinguish it. Nothing in this database
has ever left the ground.

So altitude is graphed, with its own evidence attached: the frozen samples are
marked on the trace itself. On ground data the shading covers most of the
flight — the warning made visible instead of merely asserted.

**What the shading can and cannot settle, precisely**, because an earlier draft
of this document got it wrong and the page repeated the error:

A sample is frozen when it exactly equals its predecessor. That happens when the
source is a terrain lookup *and* the receiver barely moved between fixes.
Stationary, the displacement is zero, so a terrain model repeats by
construction — which is what produced the 63% and what makes the mark
informative there. **In flight it settles nothing.** At 40 m/s the aircraft
covers 40 m between 1 Hz fixes, so a terrain model of any resolution finer than
that returns a different value every fix and the marks vanish — under both
hypotheses. "The marks disappeared, so it is a measurement" is not an inference
the data supports, and telling an operator otherwise would produce exactly the
over-trust this whole feature exists to prevent.

The discriminator in flight is the **envelope's shape**, which the chart already
draws. A terrain lookup stays pinned near field elevation while the aircraft
climbs; a real vertical solution follows the climb. Min/max per column shows
that at a glance, and no code change is needed to read it.

Both halves survive because flight segmentation keeps stationary stretches
shorter than the gap threshold inside the flight: run-up and holds stay on the
same page as the climb, so the shading that means something and the shape that
decides are read together.

## Decisions

**Aviation units are primary. Metric survives only on the stat tiles.** Knots,
feet and nautical miles are the large number everywhere — tiles, legend,
readout, flight list. Three tiles carry a metric second line in `muted`, because
the same data also gets read from a car: **Distancia** (km), **GS máx** (km/h)
and **ELEV GPS** (m). The other three do not, and not by oversight —
**Duración** belongs to no unit system, **Puntos** is a count, and **Precisión
GPS** is already metric. Nothing outside the tiles shows two numbers for one
quantity: an instrument that restates itself stops reading like an instrument.

The metres line on the elevation tile earns its place beyond convenience. The
defect in this signal is a 0.1 m step, so metres is the unit the quantisation is
legible in at all; in feet the same step is an unremarkable 0.33.

A page-wide unit toggle was rejected. It would be the only client-side state in
the whole dashboard, and it would move formatting out of the server and into the
inline script for no gain the muted second line does not already deliver.

**Precision is a decision, not a detail.** Knots are integers — nobody reads
87.3 kt. Nautical miles carry one decimal (the 223 km trip reads 120.4 NM).
Feet are integers and deliberately *not* rounded to the nearest 10 or 20 ft the
way an altimeter face is, because that rounding would conceal the 0.1 m
quantisation this feature exists to expose.

**Labels name the instrument, not the quantity.** What the phone reports is not
what the current labels claim:

- `Location.getSpeed()` is speed over the ground. It is never indicated or true
  airspeed — there is no pitot tube and no wind model. It is labelled **GS**.
- `Location.getBearing()` is direction of travel relative to **true** north, so
  it is a track, not a compass heading. It is labelled **TRK**. A pilot reading
  `Rumbo 270` assumes magnetic and eats the declination as error.
- `Precisión GPS` stays in **metres**. It is a receiver specification, not a
  cockpit reading.
- Altitude is labelled **ELEV GPS**, qualified `sobre elipsoide WGS84`. It is
  neither altitude above mean sea level nor pressure altitude, and calling it
  "altitud" would be the first step toward believing it.

**The elevation tile is styled differently from the other five.** It renders in
`warnInk` and sits last. Visually, on its own, it says "I am not like these" —
which is what replaces the removed `no se grafica` sentence without weakening
the warning into a footnote nobody reads.

**Frozen samples are reported as a fraction, not a boolean.** A sample is frozen
when its altitude is *exactly* equal to the previous sample's. Each column
stores the fraction of its samples that are frozen, and the view maps that to
shading opacity. A threshold like "shade when over half the samples repeat"
would be a number invented by the implementation; the fraction is what the data
says.

The very first sample of a flight has no predecessor, so it is neither frozen
nor counted as not-frozen: it is excluded from its column's denominator. A
one-sample column that happens to be the first therefore reports
`frozenFraction: 0` with nothing behind it, which is why `sampleCount` is
returned alongside and the view treats a column of one as unshaded.

**Columns bucket by time, not by sample index.** Capture runs at 1 Hz but the
offline queue means index and elapsed time diverge whenever coverage drops. A
gap has to render as a gap rather than compress into a dense stripe.

**Column count is a ceiling, not a target.** `columnCount` is capped at the
sample count, so a 90-second flight produces 90 columns rather than 720 columns
of which 630 are empty. Buckets that contain no sample inside a coverage gap are
returned with `sampleCount: 0` and drawn as a break in the envelope, not
interpolated across — an interpolated line over a gap is an invented
measurement.

**Each column keeps min and max, never a mean.** A mean eats the peak. The
min/max envelope preserves it, and renders the 0.1 m quantisation as the
staircase it is.

**The y axis has a floor of 100 ft.** Autoscaling to the observed range alone is
a trap this data walks straight into: a stationary or road-bound flight can span
0.3 m of recorded elevation, and scaling to that turns 10 cm of quantisation
noise into a mountain range. The span is at least 100 ft — roughly twice the
receiver's own declared ±15 m — so any variation smaller than the instrument's
error budget renders visibly flat, which is the honest picture.

When the observed span is under the floor, the floor is applied **symmetrically
around the observed midpoint**, not anchored at the minimum. Anchoring at the
minimum would push a flat track to the bottom of the frame and read as "low"
rather than as "unchanging". The tick labels always state the axis actually
drawn, so a padded axis is visible as a 100 ft span rather than hidden behind
autoscaled numbers.

**Zulu time is deferred, not rejected.** Aviation runs on UTC, but the previous
design pinned every human-facing timestamp to GMT-3 deliberately, and this
dashboard is read by one operator in one time zone. Adding a `Z` reading is a
small, self-contained change whenever it is wanted.

### Rejected alternatives for showing altitude

**Numbers only — a readout row and a max/min tile.** Cheapest by far, and
exactly what the previous design refused with reason: a bare number takes all
the authority and brings none of the evidence. It also does not answer the
request, which was to *see* the altitude.

**Colouring the map track by altitude.** Nearly free, because `bandTrack`
accepts any array of numbers and `bandTrack(altitudes, 8)` works today
untouched. But on ground data it draws a relief map, it either costs the speed
colouring or forces a toggle, and a tinted plan view does not answer a vertical
question.

## Architecture

No new service, no new dependency, no CDN origin beyond the Leaflet and OSM tile
origins already on the page. The profile is an **inline SVG generated on the
server**, in the same spirit as `layout.ts` composing HTML by hand: this is a
polyline, a shaded overlay and six tick labels, and a charting library would be
larger than the thing it draws.

Nothing changes in the database, the migrations, the device API, or
`flightRepository`. `findTrack` already selects `altitude_m` and returns
`altitudeM` on every `TrackPoint`; the detail route already hands the full point
array to the view. The data has been there since the first migration — only the
view refused it.

### The flight page is one card in three pieces

`#map` and `.inspector` are currently a single visual card: the map rounds its
top corners, the inspector has `border-top: 0` and rounds the bottom. Inserting
anything between them breaks that seam, so the card becomes three:

```
#map        border, radius top only
.profile    border, no radius, border-top: 0
.inspector  border, radius bottom only, border-top: 0
```

The profile sits above the inspector rather than below it, because the readout
and the scrub slider are the controls for *both* views, and a control belongs
under what it controls.

### Cursor linkage costs nothing

`show(i)` is already the single funnel for "the reader is now looking at point
i", already driven by both pointer and slider, and already moves the map's
cursor marker. The profile cursor hangs off the same function. Its x position is
`p[3] / totalSeconds × width` — seconds-from-start is already in the payload, so
no new client data is needed to place it.

## Components

- **`services/units.ts`** — pure conversion and formatting. `1 kt = 1852/3600
  m/s` (× 1.943844), `1 m = 3.280840 ft`, `1 NM = 1852 m`, with the formatters
  that carry the precision decisions above. Unit tested directly, the way
  `flightSegmentation` and `trackBanding` are.

  The inline client script converts speed today (`p[2] * 3.6`). It must not
  restate the knot constant: the exported value is interpolated into the script
  template (`${KNOTS_PER_MPS}`) so there is exactly one definition of what a
  knot is, and a test can assert it.

- **`services/verticalProfile.ts`** — pure:

  ```ts
  profileColumns(
    points: Array<{ capturedAt: Date; altitudeM: number }>,
    columnCount: number,
  ): ProfileColumn[]   // { x, minFt, maxFt, frozenFraction, sampleCount }
  ```

  No SVG, no Express, no database — the same shape as the other two services, so
  the frozen-sample rule and the bucketing are testable without rendering
  anything. Returns `[]` for fewer than two points.

- **`views/flightPages.ts`** — a `profile` block built like the existing
  `stats`, `legend` and `inspector` locals: a `const` returning an HTML string,
  everything interpolated through `escapeHtml`. It renders the envelope as a
  filled path, frozen columns as an overlay tinted by `frozenFraction`, three
  elevation ticks on the right and three time ticks below, plus a
  `#profile-cursor` line. Omitted entirely below two points — the same guard the
  scrub slider already uses.

  The SVG carries `viewBox="0 0 <columns> 120"` and `width: 100%` with a fixed
  CSS height, so its coordinate system is **one unit per column** and the
  browser does the scaling to whatever width the card has. Nothing in the
  generated path depends on the rendered pixel width, which is what keeps the
  server able to draw it at all. `columnCount` is requested as 720: at the
  page's 960 px maximum that is finer than one column per pixel, and the cap
  above means short flights simply produce fewer.

- **`views/theme.ts`** — two new `Palette` tokens, `profileInk` (envelope) and
  `profileFrozen` (shading). `cssVariables` emits them for both themes
  automatically, and both enter the contrast assertions. `bandSpeedBoundsKmh`
  becomes `bandSpeedBoundsKt`; the legend is its only reader.

- **The payload** gains a sixth tuple element, **appended**:
  `[lat, lon, gs, seconds, trk, elevFt]`. Appending is safe because every
  consumer indexes `p[0]`–`p[4]` literally; inserting in the middle would break
  them silently. It costs roughly 15% more payload, paid only by the readout —
  the chart is server-rendered and reads none of it.

## What a flight page shows

Six stat tiles, in order: **Distancia** (NM), **Duración**, **GS máx** (kt),
**Puntos**, **Precisión GPS** (±m), and last, in `warnInk`, **ELEV GPS máx/mín**
(ft). Distancia, GS máx and ELEV GPS carry a metric second line in `muted`; the
other three have nothing to convert.

Then the map, coloured by GS with the legend now ticked in knots. Then the
vertical profile. Then the readout — **Hora**, **GS**, **TRK**, and a new
**ELEV GPS** row — with the scrub slider.

### The warning is rewritten, not removed

This is the most important copy in the feature. The evidence stays verbatim: the
0.1 m steps, the two phones agreeing bit for bit, the 63% of stationary fixes
that never moved, the declared ±15 m, the terrain that is indistinguishable from
real altitude until the aircraft leaves it.

What changes is the closing. `Por eso no se grafica` becomes an explanation of
what the shading is and, just as importantly, what it is not evidence of: where
the value repeats fix to fix the band is shaded; stationary that mark means
something, because a terrain model queried from one spot repeats by
construction; **in flight it means nothing, because an aircraft covers 40 m
between fixes and a terrain model changes value too**; and the thing that
actually decides in the air is whether the trace stays at field elevation while
the aircraft climbs or follows it up.

The copy must not offer the absence of marks as a verdict. That sentence is the
one place on this page where a wrong inference would be actively harmful, since
it is the sentence an operator would apply on their first real flight.

## Out of scope

**Vertical speed (ft/min).** It is derived from altitude, and differentiating a
bad signal gives a worse one — the derivative amplifies exactly the 0.1 m step
that makes the source suspect. It belongs to whatever follows real flight data.

**Load factor from the accelerometer.** `accel_x/y/z` is stored on every packet
and no code has ever read it, and it is legitimate aeronautical data. But the
phone rides loose in arbitrary orientation, so its axes are not the aircraft's.
The magnitude `|a| / 9.81` *is* orientation-independent, which makes this worth
a project of its own rather than a tile — aboard an ultralight most of that
signal is vibration, and separating manoeuvre from airframe buzz is the actual
work.

Also out: live tracking, user accounts, magnetic heading and declination,
airspeed of any kind, and the altitude-coloured map track rejected above.

## Testing

**New unit tests.** `units.test.ts` — the conversion constants against their
definitions (`1852/3600` and `1/0.3048`, not the rounded literals), and the
rounding each formatter chose at its boundaries.

`verticalProfile.test.ts` — empty input, a single point, every sample frozen, no
sample frozen, the min/max envelope surviving a one-sample spike, and the four
rules that are easy to get wrong: the first sample excluded from its column's
denominator, `columnCount` capped at the sample count, a coverage gap returning
`sampleCount: 0` rather than an interpolated value, and time bucketing holding
when sample index and elapsed time diverge.

**Extended.** `flightPages.test.ts` — the SVG renders, it is absent below two
points, the labels read GS and TRK, the elevation tile is in feet with a metres
second line, the warning no longer contains `no se grafica`, and the y axis on a
flat track spans 100 ft *centred on the observed midpoint* rather than anchored
at its minimum. `theme.contrast.test.ts` — `profileInk` and `profileFrozen`
clear the contrast bar in both palettes.

**Integration.** `dashboard.test.ts` renders the flight page against the real
Postgres the suite already provisions on its own.
