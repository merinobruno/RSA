---
name: RSA — Seguimiento de vuelos
description: A measured logbook instrument: navy identity band, hairline rules, tabular numerals, one saturated live green.
colors:
  header-navy: "#0d2a54"
  header-ink: "#ffffff"
  header-link: "#9fc4ff"
  live: "#0f7a3d"
  accent: "#0288d1"
  link: "#01579b"
  bg: "#fafafa"
  surface: "#ffffff"
  border: "#e0e0e0"
  ink: "#212121"
  muted: "#616161"
  warnBg: "#fff8e1"
  warnBorder: "#f0d488"
  warnInk: "#5d4409"
  profileInk: "#37474f"
  profileFrozen: "#b26a00"
typography:
  headline:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "normal"
  title:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "normal"
  subtitle:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "normal"
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  figure:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.5
    fontFeature: "tabular-nums"
  ledger:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.5
    fontFeature: "tabular-nums"
  numeral:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tabular-nums"
  secondary:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0.07em"
  label-micro:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0.09em"
rounded:
  none: "0"
  row: "5px"
  card: "8px"
  thumb: "7px"
  dot: "50%"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  "2xl": "26px"
components:
  ledger-row:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    typography: "{typography.numeral}"
    rounded: "{rounded.row}"
    padding: "10px 8px"
  ledger-row-hover:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
  column-header:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.muted}"
    typography: "{typography.label-micro}"
    rounded: "{rounded.none}"
    padding: "9px 8px 7px"
  open-entry:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    typography: "{typography.subtitle}"
    rounded: "{rounded.none}"
    padding: "15px 8px 17px"
  open-entry-live:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.live}"
  fleet-item:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    typography: "{typography.numeral}"
    rounded: "{rounded.none}"
    padding: "0"
  day-heading:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 8px"
  stat-tile:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    typography: "{typography.figure}"
    rounded: "{rounded.none}"
    padding: "0"
  warning-callout:
    backgroundColor: "{colors.warnBg}"
    textColor: "{colors.warnInk}"
    typography: "{typography.numeral}"
    rounded: "{rounded.card}"
    padding: "12px 14px"
  map-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "12px 16px 14px"
---

# Design System: RSA — Seguimiento de vuelos

## Overview

**Creative North Star: "The Logbook Instrument"**

This is a flight logbook rendered by an instrument that refuses to overstate what it
measured. The page is paper-flat and ruled: hairlines separate entries, columns of tabular
numerals run straight down the page, and a single navy band across the top is the only
piece of the interface that does not follow the reader's colour preference. Nothing floats,
nothing glows, and nothing is boxed that a rule can separate instead.

Its density is deliberate. The index exists so an operator can run an eye down thirty
entries, so entries are rows and not cards: the equal-weight card grid and the
hero-metric slab were both refused in the build, and the one place a large numeral was
tempting — the open entry — was pulled back to 16px so it would not become a metric panel
sitting above its own column header. The one flight still in the air is the open line: it
carries the only saturated colour on the page and, uniquely, no closing rule beneath it.

Colour here is evidence, not decoration. Every colour is a `Palette` token in
`server/src/views/theme.ts`, every CSS rule reads `var(--token)`, and each pairing that
carries text or shape is asserted by a WCAG contrast test that computes the ratio itself
rather than trusting a helper from production. The product's defining honesty commitment —
that recorded altitude is not trustworthy — is drawn, not just written: the elevation stat
is the one figure rendered in warning ink, and the columns whose value merely repeated the
previous sample are shaded behind the trace.

**Key Characteristics:**

- Hairline rules instead of boxes; no shadows anywhere.
- Tabular numerals in one shared column template, from the header through every row.
- One navy identity band, fixed across both themes.
- One saturated accent (live green), and it never speaks without words beside it.
- Light and dark both first-class via `prefers-color-scheme`, with no manual toggle.
- Every colour is a token whose contrast is asserted in a test.

## Colors

A near-neutral paper-and-ink palette with exactly one saturated voice, one amber caution
family, and a fixed navy identity band that belongs to neither theme.

### Primary

- **Identity Navy** (`{colors.header-navy}`): the header band, in both light and dark. It is
  the application's identity rather than a surface, so it is defined outside both palettes
  and never inverts. Its title ink and its back-link blue are measured against it as text.
- **Airborne Green** (`{colors.live}` light / `#4ade80` dark): a flight still receiving
  packets. It carries the words "En curso" and "reportando" as well as the status light, so
  it clears the 4.5:1 text bar rather than the 3:1 UI bar. It is the only saturated colour
  on the index and is deliberately distinct from the focus accent.

### Secondary

- **Instrument Cyan** (`{colors.accent}` light / `#4fc3f7` dark): non-text emphasis only —
  focus rings, hovered borders, the selection highlight, the scrub control's accent. It
  means *focus and hover*, never state; it is held to the 3:1 UI floor and never used for
  text.
- **Chart Link Blue** (`{colors.link}` light / `#7fd4ff` dark): link text, which must clear
  the text bar rather than the UI one.

### Tertiary

- **Caution Amber Ink** (`{colors.warnInk}` light / `#e8d9b0` dark): the untrustworthy-altitude
  family. It carries the warning callout, the ELEV GPS stat and readout, and the "sin señal"
  states — a phone that has gone quiet and an open flight nothing has closed. Measured on
  three grounds: its own amber panel, the page, and a card.
- **Profile Graphite** (`{colors.profileInk}` light / `#b0bec5` dark) and **Frozen Ochre**
  (`{colors.profileFrozen}` light / `#c98f2e` dark): the elevation trace and the shading over
  columns that repeated the previous sample. The ochre is measured as it composites at
  `0.55` over the card, never as declared.

### Neutral

- **Page Paper** (`{colors.bg}` light / `#121212` dark): the page ground; also the sticky
  column header's own opaque ground so rows cannot travel through it.
- **Card White** (`{colors.surface}` light / `#1e1e1e` dark): raised surfaces — the map card,
  the profile, the inspector — and the hover ground for ledger rows.
- **Hairline** (`{colors.border}` light / `#333333` dark): every rule, every 1px card edge,
  the scrollbar thumb.
- **Ink** (`{colors.ink}` light / `#e0e0e0` dark): body text, the profile cursor, the track
  glyph's start dot.
- **Muted Ink** (`{colors.muted}` light / `#9e9e9e` dark): timestamps, stat labels, units,
  column headers, separators. The dark theme does not reuse the light theme's grey: at
  `#616161` it measures 3.0:1 on the dark page and 2.7:1 on a card, which is where every
  flight's date, duration, point count and top speed is rendered.

### Named Rules

**The Token-Only Colour Rule.** No colour is ever stated twice. Every colour is a `Palette`
key, `cssVariables()` emits one custom property per key, and every CSS rule reads
`var(--token)`. A literal hex in a stylesheet rule is a defect, not a shortcut.

**The Measured Palette Rule.** A colour enters the palette only with an executable contrast
assertion behind it, and it is measured as it renders: a tint is composited at the exact
opacity that ships before it is measured. Text pairings clear 4.5:1, non-text shape and
border pairings clear 3:1, and a region tint only has to be perceptible (1.5:1) because it
is not a shape whose form must be read.

**The Never Colour Alone Rule.** No state is ever signalled by colour alone. Contrast ratio
measures luminance and cannot express hue distinctness, so the distinction between the live
green and the focus cyan is protected by words — "En curso", "reportando", "Sin señal" —
rather than by a number that would only look like a check.

**The Honest Number Rule.** A figure the product does not trust is never rendered as if it
were trusted. Elevation is always in caution amber, everywhere it appears, and the frozen
samples behind the trace are drawn rather than footnoted.

## Typography

**Display Font:** none. There is no display face and no web font; the system UI stack does
every job at every size.
**Body Font:** system UI stack (`system-ui, -apple-system, "Segoe UI", sans-serif`), 16px/1.5.
**Label/Mono Font:** none distinct. Numeric alignment comes from
`font-variant-numeric: tabular-nums` on the same stack, not from a second family.

**Character:** Plain, local, and unbranded on purpose — the type is the instrument's
lettering, not its personality. Identity is carried by the navy band, the rules and the
column grid, so a downloaded face would add an origin and a payload without adding meaning.

### Hierarchy

- **Headline** (`{typography.headline}`, 22px): the flight page's aircraft title.
- **Title** (`{typography.title}`, 20px): the header wordmark, on the navy band.
- **Subtitle** (`{typography.subtitle}`, 19px, 600): the open entry's aircraft name and the
  hover readout's values.
- **Figure** (`{typography.figure}`, 24px, 600): the flight page's stat tiles — the only place
  a large numeral is allowed.
- **Body** (`{typography.body}`, 16px/1.5): running prose.
- **Ledger** (`{typography.ledger}`, 15px, 600): the row's local time, the gutter that anchors
  each entry.
- **Numeral** (`{typography.numeral}`, 14px, tabular): every ledger figure; 16px/600 in the
  open entry's figures, close to the ledger's own scale on purpose.
- **Secondary** (`{typography.secondary}`, 13px, muted): last-signal ages, fleet signal,
  footnotes.
- **Label** (`{typography.label}`, 12px, 600, .07em, uppercase): date headings, the open
  entry's status word (700, .08em), stat and readout labels (.04em).
- **Label Micro** (`{typography.label-micro}`, 11px, 600, .09em, uppercase): the ledger's
  sticky column header and the fleet section's own label.

### Named Rules

**The Tabular Column Rule.** Every numeral that sits in a column carries
`font-variant-numeric: tabular-nums` and is right-aligned in the wide layout. Numbers that
must be compared down a page are never proportional.

**The Bare Numeral Rule.** The column header names the unit; the rows carry bare numerals.
Below 620px the header is hidden and per-cell unit spans (`h`, `NM`, `kt máx`, `pt`) turn on
in its place. A unit is stated once per view, never twice.

**The Named Instrument Rule.** A label names the instrument, not the quantity: GS for ground
speed, TRK for true track, ELEV GPS for the WGS84-ellipsoid elevation — never "altitud".

## Layout

One centred column, `max-width: 960px`, 20px padding, on a full-bleed navy header band. The
index is a ledger: a fleet roster strip, then the open entry, then date-grouped rows, then
one footnote line.

The ledger's geometry is stated once and shared. `--nums: 3.2rem 3.4rem 3.6rem 4.4rem` is
the numeric column template for duration, distance, top speed and packet count; it is read
by the column header, every row, and the open entry's figures, so the open line's numbers
land directly above the columns they belong to. The row shell is
`3.6rem 30px minmax(0, 1fr) auto` — time gutter, track glyph, aircraft name, figures — with
a 16px column gap. The column header is sticky at `top: 0` with its own opaque page-coloured
ground, because a thirty-entry ledger otherwise scrolls its only key away.

Spacing rhythm is a coarse 4px-based set: 2 and 4 for optical nudges, 8 for intra-component
gaps, 12–16 for component padding, 20 for the page gutter, 22–26 for the gaps between the
ledger's structural parts. Rows are 10px×8px; the open entry is 15px top and 17px bottom, a
deliberate asymmetry under a line with no closing rule.

One breakpoint, `max-width: 620px`. It hides the column header, turns on the per-cell units,
reflows the row into a two-line block (glyph spanning both lines, name and time on the
first, figures on the second, left-aligned), collapses the fleet roster to one device per
line, and places every part of the open entry explicitly so the reading order stays *what is
happening, which aircraft, then the numbers*.

## Elevation & Depth

Flat. There are no shadows in this system and no elevation ramp. Depth is tonal and linear:
a raised surface is the card tone against the page tone, and separation is a 1px hairline in
the border token. Hover does not lift; it swaps the row's ground from page to card and
underlines the aircraft name.

The single `box-shadow` in the stylesheet is `inset 0 0 0 1.5px var(--warnInk)` on the
silent device's status light — an inset ring that hollows the dot. It draws a shape, not a
depth.

### Named Rules

**The No-Shadow Rule.** Surfaces are flat at every state. If something must read as raised,
give it the card tone and a hairline; if something must read as separated, rule it. An offset
drop shadow has no place in this world.

**The Hairline-Over-Box Rule.** A hairline separates; a box encloses. Entries in a ledger are
separated, so no entry ever gets a box of its own. A border only becomes a full outline on a
genuine container: the map card, the profile, the inspector, the warning callout.

**The Contrast-Floor Hover Rule.** A hover mark must clear the same contrast floor as the
resting rules around it. The row's background swap alone is 1.02:1 in light and an inset
border-token hairline is 1.27:1, so the actual mark is an underline on the aircraft name at
full ink contrast — which is also the conventional affordance for what the row is: a link.

## Shapes

Rectilinear and lightly softened. Hairlines are 1px; the live and pending rules that open an
entry are 2px in their own colour. Radii are small and purposeful: 5px on ledger rows (a
hover ground, not a card), 8px on the map card's outer corners, 0 on the profile that joins
the map to the inspector so the three read as one card with rounded ends, 5px on the legend
ramp, 7px on the scrollbar thumb, and full circles for status lights and the live pulse.

Iconography is drawn, never borrowed. The disclosure caret is two 1.5px borders on a rotated
pseudo-element that turns with the details element. The track glyph is a server-drawn SVG
polyline in a `-0.08 -0.08 1.16 1.16` viewBox with non-scaling strokes — 1.4 stroke in the
row, 1.9 at the open entry's larger size — with a filled dot at the start point. There is no
icon font and no icon package.

## Components

### Fleet Roster

A compact strip under the header, in a `details` element that opens itself only when a
device has gone silent. Character: a status board, read in one pass.

- **Shape:** no container; a 12px bottom pad over a single hairline.
- **Summary:** micro label ("Flota") plus a middle-dot-separated tally — live count in green,
  silent count in caution amber, total in muted — with a drawn caret pushed to the far right.
- **List:** `auto-fill` grid of 260px minimum tracks, `7px minmax(0,1fr) auto` per item; names
  truncate with an ellipsis and never wrap.
- **States:** live device — filled green dot, green signal text; silent — hollow dot (inset
  amber ring) and amber text, because a phone that has gone quiet is a thing to look at, not
  an alarm; quiet — muted dot and muted text.
- **Focus:** 2px accent outline, 3px offset, on the summary.

### Open Entry (signature component)

The flight that has not been closed yet, in the same grammar as the rows below it, one step
larger. Character: the open line of a logbook.

- **Shape:** full-width ruled band, no box, `15px 8px 17px`.
- **The open line's mark:** ruled top and bottom when closed; when live, a 2px green top rule
  and **no bottom rule at all**; when pending ("Sin señal", nothing has closed it), the same
  missing bottom rule with an amber top rule instead of the green it has not earned.
- **Content:** status word row (uppercase, 700, .08em) with the pulse or the age; a large
  track glyph; aircraft name at 19px/600 with its local date-time beneath in muted; the four
  ledger figures at 16px/600 on the shared `--nums` template.
- **Hover:** card ground plus an underline on the aircraft name.
- **Motion:** one authored animation, `live-ping` — a ring leaving the live dot every 2.6s,
  transform and opacity only, on a pseudo-element so the compositor handles it. The dot itself
  never animates, so nothing the reader needs is ever mid-fade.

### Ledger Row

Character: a line in a book, not a card in a feed.

- **Shape:** 5px radius, `10px 8px`, separated from its sibling by a 1px hairline
  (`.row + .row`), never by a border of its own.
- **Columns:** local time (15px/600 tabular), track glyph, aircraft name (truncating),
  then duration, NM, GS max and points, right-aligned and tabular, with the point count in
  muted.
- **Hover / Focus:** card ground plus an underlined aircraft name; focus-visible is a 2px
  accent outline at 2px offset.

### Date Heading and Day Total

A baseline-aligned pair: the uppercase day name ("Hoy", "Ayer", weekday and date) at one end,
the day's flown total at the other in a lighter weight with tabular numerals. A logbook foots
every page; the total is what turns the heading from a label into a fact the reader can check
against the rows beneath it.

### Stat Tiles

Flex-wrapped, 20px gaps, no boxes: a 24px/600 value over a 13px uppercase muted label. Metric
values appear only here, as a 14px muted second line — an instrument that restates itself
everywhere stops reading like an instrument. The ELEV GPS tile is the one tile rendered in
caution amber, because it is not as solid as the five beside it and should not look it.

### Elevation Profile

A server-drawn SVG, one unit per column and 120 tall, stretched to the card's width with
`preserveAspectRatio="none"` — so nothing the server draws needs to know the rendered pixel
width, and no text is ever drawn inside the viewBox. Full-height frozen bands are painted
first in ochre at up to 0.55 opacity, so the trace stays on top of its own caveat; the
envelope is one 1-unit rect per column with a 1.5-unit floor so a flat column stays visible.
Columns with no samples are skipped entirely: a line drawn across a coverage gap is a
measurement nobody took. Axis and tick labels live in HTML around the SVG.

### Speed Legend

An 8-step continuous ramp, 10px tall with a 5px radius, over a from/to tick pair in muted
tabular numerals. The ramp is data (`SPEED_RAMP`) read by both the legend and the line on the
map, so the two cannot describe different things, and its bounds are computed per flight
because the bands are relative to that flight's fastest point — printing one fixed scale
under a relative ramp would state something untrue of the picture above it.

### Readout

Under the map, never floating over it: label-above-value pairs (12px uppercase muted label,
19px/600 tabular value) in a wrapping flex row with a 30px minimum height so the card does
not jump when it appears. ELEV GPS is in caution amber here too. Hidden state relies on an
explicit `[hidden] { display: none !important; }` because the readout is a flex container and
any author display declaration beats the user-agent `[hidden]` rule.

### Warning Callout

Amber panel, 1px amber border, 8px radius, `12px 14px`, amber ink, with a block-level `strong`
lead line. This is the altitude honesty commitment rendered as a component.

### Navigation

There is no navigation beyond the header: a wordmark linking home, and — on the flight page —
a back link in header-link blue at 14px with a `currentColor` bottom hairline that brightens
to white on hover.

### Browser Surfaces

The parts nobody draws are still themed from the palette: `::selection` is accent on surface,
and the scrollbar is a 12px border-token thumb inset 3px in the page colour with a 7px radius,
plus `scrollbar-color`/`scrollbar-width` for Firefox. A `prefers-reduced-motion` guard clamps
every animation and transition to 0.01ms.

## Do's and Don'ts

### Do:

- **Do** define every colour as a `Palette` key in `theme.ts` and read it as `var(--token)`;
  add its contrast assertion to `theme.contrast.test.ts` in the same change.
- **Do** measure a tint as it composites at the exact opacity that ships (`MAX_FROZEN_OPACITY`
  is 0.55; past 0.59 the dark theme's trace-on-shading falls below 3:1).
- **Do** separate repeated entries with hairlines and reach for the shared `--nums` template
  whenever a new numeric column appears, so the columns stay columns down the whole page.
- **Do** give every numeral column `font-variant-numeric: tabular-nums`.
- **Do** state a state in words as well as in colour.
- **Do** keep both themes first-class through `prefers-color-scheme`, and keep the navy band
  outside both palettes.
- **Do** draw icons as SVG or from borders, and keep glyph SVGs stroke-scaled with
  `vector-effect="non-scaling-stroke"`.
- **Do** animate transform and opacity only, on a pseudo-element, and keep the reduced-motion
  guard in place.
- **Do** write UI copy in Spanish (`<html lang="es">`) with aviation units primary (kt, ft, NM)
  and metric only as a muted second line on the stat tiles.
- **Do** label a figure with its instrument (GS, TRK, ELEV GPS).

### Don't:

- **Don't** put a colour literal in a CSS rule, or restate a token's value anywhere but
  `theme.ts`.
- **Don't** add a box shadow. This world is flat; use the card tone and a hairline.
- **Don't** box a ledger entry, and don't rely on a background swap alone as a hover mark —
  it measures 1.02:1.
- **Don't** grow the open entry's figures into a hero-metric slab; they sit near the ledger's
  own scale, directly above the columns that name them.
- **Don't** give the live line a closing rule. The missing bottom border is the whole
  metaphor.
- **Don't** signal state with hue alone, and don't use the focus accent for text or for state.
- **Don't** put a backtick in any comment in `layout.ts`. The whole stylesheet is a template
  literal; a backtick ends it and turns the next selector into a property access. This has
  broken the build twice.
- **Don't** introduce a template engine, a client bundler, or a build step for client
  JavaScript, which ships as an ES5 string literal inside the view and is never type-checked.
- **Don't** add a third client origin. Leaflet 1.9.4 and OpenStreetMap tiles, both SRI-pinned,
  are the only ones, and only on the flight page.
- **Don't** add a web font or an icon font.
- **Don't** add a manual theme toggle.
- **Don't** draw text inside the profile SVG's stretched viewBox.
- **Don't** make a number look more authoritative than it is. Elevation stays in caution
  amber, with its evidence attached.
