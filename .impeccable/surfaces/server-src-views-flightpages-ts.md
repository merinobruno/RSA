---
version: 1
slug: "server-src-views-flightpages-ts"
primary_target: "server/src/views/flightPages.ts"
related_targets: ["server/src/views/layout.ts","server/src/db/flightRepository.ts"]
---

Scope: the flight index at `/` — the dashboard's front door. Visitor mode:
**Operate**. Audience: the operator, post-flight on a laptop or a cheap phone.
Job: open the flight just flown, know whether one is airborne now, and find an
older one by memory. Constraint: server-rendered strings, no bundler, no third
CDN origin, existing palette tokens, light and dark both first-class.

## Direction contract

THESIS: a pilot's logbook, not a feed of cards. Ruled entries with a date
gutter and aligned tabular columns; the in-progress flight is the open line not
yet closed. It refuses the equal-weight card grid the incumbent list implies
and the hero-metric slab that usually replaces it.

OWN-WORLD: the established dashboard world, inherited whole — navy identity
band, `Palette` tokens, system stack. Its logbook grammar is hairline rules
instead of boxes, a fixed left gutter, tabular numerals in right-aligned
numeric columns, and one saturated live accent as the only colour event on an
otherwise neutral page.

STORY: the operator sees at a glance whether anything is flying and whether
every phone is still reporting, recognises a past flight by the shape of its
track before reading a date, and opens it in one click.

FIRST VIEWPORT: a compact fleet roster strip under the header — one line per
device, last signal, quiet warning when one has gone silent. Beneath it the
open entry: the live or most recent flight as a full-width ruled row with its
track glyph, elapsed time, and GS/distance columns. Below that the logbook
proper, grouped under date headings ("Hoy", "Ayer", weekday and date), one
ruled row per flight. Primary action is the row itself.

FORM: logbook ledger, first on the ordered list of structures the content
allows (ledger, roster-first fleet view, timeline rail, map-index, calendar
grid). No seed key: this is a precisely specified surface inside an established
world, which new-work.md §3 excludes from the concept roll.

FINISH: unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, DESIGN.md, and every shipping raster carrying its
provenance.

## Unresolved

Nothing blocking. Zulu time remains deferred project-wide. A live *map* was
declined by the operator as optional; only in-progress detection was required,
and it is derived from packet recency rather than any live channel.
