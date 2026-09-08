# Aeronautical Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the flight dashboard read as an aeronautical instrument — knots, feet and nautical miles, labels that name what the sensor actually measures — and add a server-rendered vertical elevation profile that shows the altitude alongside the evidence that it cannot yet be trusted.

**Architecture:** Two new pure services (`units`, `verticalProfile`) carry every conversion and every reduction rule, tested without rendering anything. The profile itself is an inline SVG generated in `flightPages.ts` and styled from palette tokens in `layout.ts` — no charting library, no CDN origin beyond the Leaflet and OpenStreetMap ones already on the page, no build step for client JS. Nothing in the database, the migrations, the device API or `flightRepository` changes: `findTrack` has always returned `altitudeM`, and only the view refused it.

**Tech Stack:** TypeScript, Express, Postgres (`pg`), Vitest, supertest, Leaflet 1.9.4 via unpkg. Server-rendered HTML from plain template functions — no template engine.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-09-08-aeronautical-dashboard-design.md`. Read it before Task 1.
- **All commands run from `server/`.** The repo root is `P:\dev\RSA`; the Node project is `P:\dev\RSA\server`.
- **Vitest's `globalSetup` connects to Postgres on every run**, including a unit-only one, so a bare `npx vitest run test/unit` fails with `ECONNREFUSED :5432` unless a database happens to be up. Wrap it: `node scripts/with-postgres.mjs npx vitest run test/unit`, which provisions one and tears it down — the same thing `npm test` does for the whole suite. Every `npx vitest run …` command below is shorthand for the wrapped form.
- **UI copy is Spanish**, matching `<html lang="es">`. Code, identifiers, comments and commit messages are English. Do not translate existing Spanish strings.
- **Everything interpolated into HTML goes through `escapeHtml`, without exception** — the house rule in `src/views/layout.ts:5-7`, applied even to values that are provably numbers (see the precedent at `src/views/flightPages.ts:121-122`).
- **Colours are never stated twice.** Every colour is a `Palette` token in `src/views/theme.ts`; CSS rules read `var(--token)`. Adding a token to the `Palette` interface makes `cssVariables` emit it for both themes automatically.
- **Conversion factors are defined from their definitions**, not from rounded decimals: 1 NM = exactly 1852 m, 1 ft = exactly 0.3048 m, 1 kt = 1 NM/h.
- **Client JS is ES5-style** (`var`, `function`, no optional chaining, no modules) inside a template literal. `tsc` never sees it — a syntax error there is invisible until the page runs.
- **Commit after every task**, conventional commits, no AI attribution or `Co-Authored-By` trailers.

---

### Task 1: Aviation units

**Files:**
- Create: `server/src/services/units.ts`
- Test: `server/test/unit/units.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `METRES_PER_NAUTICAL_MILE: number`, `METRES_PER_FOOT: number`, `KNOTS_PER_MPS: number`, `toKnots(metresPerSecond: number): number`, `toFeet(metres: number): number`, `toNauticalMiles(metres: number): number`, `formatKnots(metresPerSecond: number): string`, `formatFeet(metres: number): string`, `formatNauticalMiles(metres: number): string`.

- [ ] **Step 1: Write the failing test**

Create `server/test/unit/units.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  KNOTS_PER_MPS,
  formatFeet,
  formatKnots,
  formatNauticalMiles,
  toFeet,
  toKnots,
  toNauticalMiles,
} from "../../src/services/units";

describe("aviation units", () => {
  it("defines a knot as one nautical mile per hour", () => {
    expect(toKnots(1852 / 3600)).toBeCloseTo(1, 10);
  });

  it("defines a foot as exactly 0.3048 m", () => {
    expect(toFeet(0.3048)).toBeCloseTo(1, 10);
  });

  it("defines a nautical mile as exactly 1852 m", () => {
    expect(toNauticalMiles(1852)).toBeCloseTo(1, 10);
  });

  it("hands the client script the same factor the server uses", () => {
    // The inline script converts speed for the readout itself. If these two ever drift, the map's
    // readout and the stat tile above it report different speeds for the same point.
    expect(KNOTS_PER_MPS).toBeCloseTo(1.943844, 6);
  });

  it("states speed in whole knots", () => {
    // 45 m/s is 87.47 kt. Nobody reads a decimal off an ASI, and one here would claim a precision
    // the receiver does not have.
    expect(formatKnots(45)).toBe("87 kt");
    expect(formatKnots(0)).toBe("0 kt");
  });

  it("states elevation in whole feet without rounding to an altimeter's steps", () => {
    // 300 m is 984.25 ft. Rounding to the nearest 10 or 20 ft the way an altimeter face does would
    // conceal the 0.1 m quantisation this dashboard exists to expose.
    expect(formatFeet(300)).toBe("984 ft");
  });

  it("keeps elevation below the ellipsoid negative rather than clamping it", () => {
    expect(formatFeet(-30.48)).toBe("-100 ft");
  });

  it("states distance in nautical miles to one decimal", () => {
    // The 223 km field test.
    expect(formatNauticalMiles(223000)).toBe("120.4 NM");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd server && npx vitest run test/unit/units.test.ts
```

Expected: FAIL — `Failed to resolve import "../../src/services/units"`.

- [ ] **Step 3: Write the implementation**

Create `server/src/services/units.ts`:

```ts
/**
 * The units an aircraft is flown in, as conversions rather than as factors sprinkled through the
 * views.
 *
 * Stated from their definitions and not from rounded decimals: a nautical mile is exactly 1852
 * metres and a foot exactly 0.3048, so a knot is 1852/3600 m/s rather than 0.5144. The tests assert
 * the definitions, which is only possible if the code states them.
 */

/** Exactly 1852 metres, by international agreement. */
export const METRES_PER_NAUTICAL_MILE = 1852;

/** Exactly 0.3048 metres, by international agreement. */
export const METRES_PER_FOOT = 0.3048;

/** One nautical mile per hour. */
export const METRES_PER_SECOND_PER_KNOT = METRES_PER_NAUTICAL_MILE / 3600;

/**
 * The one definition of a knot in this codebase. The inline client script converts speed for its
 * own readout, and it is handed this value rather than a literal of its own.
 */
export const KNOTS_PER_MPS = 1 / METRES_PER_SECOND_PER_KNOT;

export function toKnots(metresPerSecond: number): number {
  return metresPerSecond * KNOTS_PER_MPS;
}

export function toFeet(metres: number): number {
  return metres / METRES_PER_FOOT;
}

export function toNauticalMiles(metres: number): number {
  return metres / METRES_PER_NAUTICAL_MILE;
}

/** Whole knots. A decimal would imply a precision the receiver does not have. */
export function formatKnots(metresPerSecond: number): string {
  return `${Math.round(toKnots(metresPerSecond))} kt`;
}

/**
 * Whole feet, and deliberately NOT rounded to the nearest 10 or 20 ft the way an altimeter face
 * reads. That rounding would hide the 0.1 m quantisation the elevation profile exists to show.
 */
export function formatFeet(metres: number): string {
  return `${Math.round(toFeet(metres))} ft`;
}

export function formatNauticalMiles(metres: number): string {
  return `${toNauticalMiles(metres).toFixed(1)} NM`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd server && npx vitest run test/unit/units.test.ts
```

Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/units.ts server/test/unit/units.test.ts
git commit -m "feat(server): state distance, speed and elevation in aviation units"
```

---

### Task 2: The vertical profile reduction

**Files:**
- Create: `server/src/services/verticalProfile.ts`
- Test: `server/test/unit/verticalProfile.test.ts`

**Interfaces:**
- Consumes: `toFeet` from Task 1.
- Produces: `MINIMUM_SPAN_FT: number`, `interface ProfileSample { capturedAt: Date; altitudeM: number }`, `interface ProfileColumn { x: number; minFt: number; maxFt: number; frozenFraction: number; sampleCount: number }`, `interface ProfileScale { minFt: number; maxFt: number }`, `profileColumns(samples: ProfileSample[], columnCount: number): ProfileColumn[]`, `profileScale(columns: ProfileColumn[]): ProfileScale`.

- [ ] **Step 1: Write the failing test**

Create `server/test/unit/verticalProfile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  MINIMUM_SPAN_FT,
  type ProfileSample,
  profileColumns,
  profileScale,
} from "../../src/services/verticalProfile";

const SECOND = 1000;
const BASE = Date.parse("2026-09-07T22:16:00.000Z");

/** A 1 Hz run, which is what the app records. */
function samples(count: number, altitudeAt: (i: number) => number = () => 300): ProfileSample[] {
  return Array.from({ length: count }, (_, i) => ({
    capturedAt: new Date(BASE + i * SECOND),
    altitudeM: altitudeAt(i),
  }));
}

describe("profileColumns", () => {
  it("draws nothing from a track that has no shape yet", () => {
    expect(profileColumns([], 720)).toEqual([]);
    expect(profileColumns(samples(1), 720)).toEqual([]);
  });

  it("rejects a column count that cannot describe a chart", () => {
    expect(() => profileColumns(samples(10), 0)).toThrow(/positive integer/);
    expect(() => profileColumns(samples(10), 2.5)).toThrow(/positive integer/);
  });

  it("treats the column count as a ceiling, not a target", () => {
    // 720 columns over a 90 second flight would be 630 empty ones.
    expect(profileColumns(samples(90), 720)).toHaveLength(90);
    expect(profileColumns(samples(5000), 720)).toHaveLength(720);
  });

  it("keeps the extremes of each column rather than averaging them away", () => {
    // One spike in a column of otherwise flat samples. A mean would eat it.
    const points = samples(100, (i) => (i === 42 ? 900 : 300));

    const columns = profileColumns(points, 10);
    const spiked = columns.filter((c) => c.maxFt > 1000);

    expect(spiked).toHaveLength(1);
    expect(spiked[0].maxFt).toBeCloseTo(900 / 0.3048, 6);
    expect(spiked[0].minFt).toBeCloseTo(300 / 0.3048, 6);
  });

  it("reports a fraction frozen rather than a verdict", () => {
    // Every other sample repeats its predecessor exactly.
    const points = samples(101, (i) => 300 + Math.floor(i / 2) * 0.1);

    const [column] = profileColumns(points, 1);

    expect(column.frozenFraction).toBeCloseTo(0.5, 2);
  });

  it("marks a stream that never moves as entirely frozen", () => {
    const [column] = profileColumns(samples(100), 1);

    expect(column.frozenFraction).toBe(1);
    expect(column.sampleCount).toBe(100);
  });

  it("marks a stream that always moves as never frozen", () => {
    const [column] = profileColumns(samples(100, (i) => 300 + i), 1);

    expect(column.frozenFraction).toBe(0);
  });

  it("excludes the very first sample from its column's denominator", () => {
    // The first sample has no predecessor, so it is neither frozen nor not-frozen. Counting it
    // either way would make the first column state something it cannot know.
    const points = samples(3, () => 300);

    const [first] = profileColumns(points, 1);

    // Three samples, two comparisons, both frozen - not two out of three.
    expect(first.frozenFraction).toBe(1);
  });

  it("buckets by elapsed time, not by sample index", () => {
    // The offline queue makes the two diverge: 10 samples in the first second, then one a minute
    // later. By index they would split down the middle; by time the first ten share one column.
    const points: ProfileSample[] = [
      ...Array.from({ length: 10 }, (_, i) => ({
        capturedAt: new Date(BASE + i * 100),
        altitudeM: 300,
      })),
      { capturedAt: new Date(BASE + 60 * SECOND), altitudeM: 900 },
    ];

    const columns = profileColumns(points, 10);

    expect(columns[0].sampleCount).toBe(10);
    expect(columns[columns.length - 1].sampleCount).toBe(1);
  });

  it("leaves a coverage gap empty instead of inventing a value across it", () => {
    // An interpolated line over a gap is a measurement nobody took.
    const points: ProfileSample[] = [
      { capturedAt: new Date(BASE), altitudeM: 300 },
      { capturedAt: new Date(BASE + SECOND), altitudeM: 300 },
      { capturedAt: new Date(BASE + 600 * SECOND), altitudeM: 900 },
    ];

    const columns = profileColumns(points, 10);
    const empty = columns.filter((c) => c.sampleCount === 0);

    expect(empty.length).toBeGreaterThan(0);
    for (const column of empty) {
      expect(column.minFt).toBe(0);
      expect(column.maxFt).toBe(0);
      expect(column.frozenFraction).toBe(0);
    }
  });

  it("numbers each column with its own x so the view needs no index arithmetic", () => {
    const columns = profileColumns(samples(50), 10);

    expect(columns.map((c) => c.x)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("profileScale", () => {
  it("uses the observed range when the flight actually climbed", () => {
    const columns = profileColumns(samples(100, (i) => 300 + i * 10), 10);

    const scale = profileScale(columns);

    expect(scale.maxFt - scale.minFt).toBeGreaterThan(MINIMUM_SPAN_FT);
    expect(scale.maxFt).toBeCloseTo(1290 / 0.3048, 6);
  });

  it("pads a flat track to a floor so quantisation does not read as terrain", () => {
    // 0.3 m of recorded variation autoscaled to the frame turns 10 cm of noise into a mountain.
    const columns = profileColumns(samples(100, (i) => 300 + (i % 4) * 0.1), 10);

    const scale = profileScale(columns);

    expect(scale.maxFt - scale.minFt).toBeCloseTo(MINIMUM_SPAN_FT, 6);
  });

  it("centres the padded span on the observed midpoint rather than its floor", () => {
    // Anchored at the minimum, a flat track drops to the bottom of the frame and reads as "low"
    // instead of as "unchanging".
    const columns = profileColumns(samples(100), 10);
    const flatFt = 300 / 0.3048;

    const scale = profileScale(columns);

    expect((scale.minFt + scale.maxFt) / 2).toBeCloseTo(flatFt, 6);
    expect(scale.minFt).toBeCloseTo(flatFt - MINIMUM_SPAN_FT / 2, 6);
  });

  it("returns a drawable frame for a track with no columns at all", () => {
    const scale = profileScale([]);

    expect(scale.maxFt - scale.minFt).toBe(MINIMUM_SPAN_FT);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd server && npx vitest run test/unit/verticalProfile.test.ts
```

Expected: FAIL — `Failed to resolve import "../../src/services/verticalProfile"`.

- [ ] **Step 3: Write the implementation**

Create `server/src/services/verticalProfile.ts`:

```ts
/**
 * Reduces a flight's elevation samples to a fixed number of columns for the vertical profile.
 *
 * Pure, like [flightSegmentation] and [trackBanding]: no SVG, no Express, no database. The two
 * rules that carry the meaning - what counts as a frozen sample, and how a coverage gap renders -
 * are the ones easiest to get quietly wrong, so they are testable without rendering anything.
 */

import { toFeet } from "./units";

/**
 * The smallest span the y axis will ever draw, in feet.
 *
 * Roughly twice the +/-15 m the receiver declares. Autoscaling to the observed range alone is a
 * trap this data walks straight into: a road-bound track can span 0.3 m of recorded elevation, and
 * scaling to that turns 10 cm of quantisation into a mountain range. Below the instrument's own
 * error budget, flat is the honest picture.
 */
export const MINIMUM_SPAN_FT = 100;

export interface ProfileSample {
  capturedAt: Date;
  altitudeM: number;
}

export interface ProfileColumn {
  /** 0-based index, which is also this column's x coordinate in the SVG's viewBox. */
  x: number;
  /** The lowest and highest elevation in this column, in feet. Both 0 when it holds nothing. */
  minFt: number;
  maxFt: number;
  /**
   * How much of this column repeated the previous sample exactly, 0 to 1.
   *
   * Not a boolean. A threshold like "shade when over half the samples repeat" would be a number
   * invented here rather than one the data states; the fraction is what was actually observed.
   */
  frozenFraction: number;
  /** 0 where a coverage gap left this column with nothing in it. */
  sampleCount: number;
}

export interface ProfileScale {
  minFt: number;
  maxFt: number;
}

export function profileColumns(samples: ProfileSample[], columnCount: number): ProfileColumn[] {
  if (!Number.isInteger(columnCount) || columnCount < 1) {
    throw new Error(`Invalid column count ${columnCount}. It must be a positive integer.`);
  }
  if (samples.length < 2) return [];

  // A ceiling, not a target: 720 columns over a 90 second flight would be 630 empty ones.
  const columns = Math.min(columnCount, samples.length);

  const startMs = samples[0].capturedAt.getTime();
  const endMs = samples[samples.length - 1].capturedAt.getTime();
  // At least 1, so a stream whose samples all share an instant still divides.
  const span = Math.max(endMs - startMs, 1);

  const buckets = Array.from({ length: columns }, () => ({
    min: Infinity,
    max: -Infinity,
    frozen: 0,
    compared: 0,
    total: 0,
  }));

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];

    // Bucketed by elapsed time rather than by index. The offline queue makes the two diverge
    // whenever coverage drops, and a gap has to stay a gap instead of compressing into a stripe.
    const ratio = (sample.capturedAt.getTime() - startMs) / span;
    const bucket = buckets[Math.min(Math.floor(ratio * columns), columns - 1)];

    const ft = toFeet(sample.altitudeM);
    if (ft < bucket.min) bucket.min = ft;
    if (ft > bucket.max) bucket.max = ft;
    bucket.total++;

    // The first sample of the flight has no predecessor, so it is neither frozen nor not-frozen.
    // Counting it either way would make the first column state something it cannot know.
    if (i > 0) {
      bucket.compared++;
      if (sample.altitudeM === samples[i - 1].altitudeM) bucket.frozen++;
    }
  }

  return buckets.map((bucket, x) => ({
    x,
    minFt: bucket.total > 0 ? bucket.min : 0,
    maxFt: bucket.total > 0 ? bucket.max : 0,
    frozenFraction: bucket.compared > 0 ? bucket.frozen / bucket.compared : 0,
    sampleCount: bucket.total,
  }));
}

export function profileScale(columns: ProfileColumn[]): ProfileScale {
  let min = Infinity;
  let max = -Infinity;
  for (const column of columns) {
    if (column.sampleCount === 0) continue;
    if (column.minFt < min) min = column.minFt;
    if (column.maxFt > max) max = column.maxFt;
  }

  if (min === Infinity) return { minFt: 0, maxFt: MINIMUM_SPAN_FT };
  if (max - min >= MINIMUM_SPAN_FT) return { minFt: min, maxFt: max };

  // Padded around the observed midpoint rather than anchored at the minimum. Anchoring would drop
  // a flat track to the floor of the frame, where it reads as "low" instead of as "unchanging".
  const midpoint = (min + max) / 2;
  return { minFt: midpoint - MINIMUM_SPAN_FT / 2, maxFt: midpoint + MINIMUM_SPAN_FT / 2 };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd server && npx vitest run test/unit/verticalProfile.test.ts
```

Expected: PASS — 15 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/verticalProfile.ts server/test/unit/verticalProfile.test.ts
git commit -m "feat(server): reduce a flight's elevation to columns that carry their own evidence"
```

---

### Task 3: Palette tokens for the profile

**Files:**
- Modify: `server/src/views/theme.ts:9-26` (the `Palette` interface), `:28-54` (both palettes)
- Test: `server/test/unit/theme.contrast.test.ts:44-76` (the per-palette block)

**Interfaces:**
- Consumes: nothing.
- Produces: `Palette` gains `profileInk: string` and `profileFrozen: string`, which `cssVariables` then emits as `--profileInk` and `--profileFrozen` for both themes automatically.

This task deliberately does **not** touch `bandSpeedBoundsKmh`. Renaming it here would leave `flightPages.ts` referring to a function that no longer exists, so the repository would not compile between this commit and the next. The rename lives in Task 4, with its caller.

- [ ] **Step 1: Write the failing tests**

In `server/test/unit/theme.contrast.test.ts`, add these three tests inside the existing `describe.each([...])("%s palette", ...)` block, after the `keeps the accent visible as a border` test at line 73:

```ts
  it("renders the elevation stat readably on the page and on a card", () => {
    // The elevation tile is the one stat rendered in warnInk, and it sits on the page rather than
    // on the warning's own amber background - which is the only pairing the palette was measured
    // for until now.
    expect(contrastRatio(palette.warnInk, palette.bg)).toBeGreaterThanOrEqual(TEXT_MINIMUM);
    expect(contrastRatio(palette.warnInk, palette.surface)).toBeGreaterThanOrEqual(TEXT_MINIMUM);
  });

  it("draws the elevation profile visibly against the card it sits on", () => {
    expect(contrastRatio(palette.profileInk, palette.surface)).toBeGreaterThanOrEqual(UI_MINIMUM);
  });

  it("keeps the frozen shading visible and distinct from the trace it marks", () => {
    // Measured as it actually renders. The shading is never painted at full strength - it is a
    // tint at MAX_FROZEN_OPACITY over the card - so asserting the raw token would bind a colour
    // that never reaches a screen.
    const shading = over(palette.profileFrozen, palette.surface, MAX_FROZEN_OPACITY);

    // Visible at all against the card behind it. TINT_MINIMUM, not UI_MINIMUM: a region tint is
    // not a shape that carries meaning, so WCAG's 3:1 does not apply to this pairing.
    expect(contrastRatio(shading, palette.surface)).toBeGreaterThanOrEqual(TINT_MINIMUM);
    // This one is the real requirement. Shading that cannot be told from the trace drawn on top
    // of it turns the warning into decoration.
    expect(contrastRatio(shading, palette.profileInk)).toBeGreaterThanOrEqual(UI_MINIMUM);
  });
```

And add these three helpers at module level in the same file, after the existing `UI_MINIMUM` constant (line 30):

```ts
/** The strongest the profile ever paints a frozen column. Task 5 renders at this opacity. */
const MAX_FROZEN_OPACITY = 0.55;

/**
 * A floor for "perceptible as a tint", not a WCAG threshold - the spec sets none for a shaded
 * region, because a tint is not a shape whose form has to be read. The accessibility requirement
 * for this pairing is the trace-on-shading ratio below it.
 */
const TINT_MINIMUM = 1.5;

/** Alpha compositing, so a colour can be measured as it renders rather than as it is declared. */
function over(foreground: string, background: string, alpha: number): string {
  const channels = (hex: string) =>
    [0, 2, 4].map((i) => parseInt(hex.replace("#", "").slice(i, i + 2), 16));
  const [fr, fg, fb] = channels(foreground);
  const [br, bg, bb] = channels(background);

  return `#${[[fr, br], [fg, bg], [fb, bb]]
    .map(([f, b]) =>
      Math.round(f * alpha + b * (1 - alpha))
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && npx vitest run test/unit/theme.contrast.test.ts
```

Expected: FAIL — `palette.profileInk` is `undefined`, so `relativeLuminance` throws on `undefined.replace`.

- [ ] **Step 3: Add the tokens**

In `server/src/views/theme.ts`, add to the `Palette` interface after `warnInk: string;` (line 25):

```ts
  /** The elevation profile's trace. Non-text: it is a shape, not a label. */
  profileInk: string;
  /** The shading over profile columns that repeated the previous sample. */
  profileFrozen: string;
```

Add to `LIGHT` after `warnInk: "#5d4409",` (line 38):

```ts
  profileInk: "#37474f",
  profileFrozen: "#b26a00",
```

Add to `DARK` after `warnInk: "#e8d9b0",` (line 53):

```ts
  profileInk: "#b0bec5",
  profileFrozen: "#c98f2e",
```

Not the light theme's `#b26a00`, and not a lighter amber either. Composited at
`MAX_FROZEN_OPACITY` over the dark card, an amber any brighter than this lands within 2.7:1 of
`profileInk` — the pale trace stops separating from its own shading exactly where the shading is
densest, which is where the reader most needs to read it.

- [ ] **Step 4: Run the whole unit suite and the type check**

```bash
cd server && npx vitest run test/unit && npx tsc --noEmit
```

Expected: PASS, and `tsc` clean. Adding tokens breaks nothing — every existing rule reads the ones it already had.

- [ ] **Step 5: Commit**

```bash
git add server/src/views/theme.ts server/test/unit/theme.contrast.test.ts
git commit -m "feat(server): add palette tokens for the elevation profile"
```

---

### Task 4: Aviation units and honest labels across both pages

**Files:**
- Modify: `server/src/views/theme.ts:97-117` (`BandSpeedBounds` and `bandSpeedBoundsKmh`)
- Modify: `server/src/views/flightPages.ts` (imports, `flightListPage`, `flightPayload`, `flightDetailPage`)
- Modify: `server/src/views/layout.ts:81-88` (the `.stats` rules)
- Create: `server/test/unit/legendKnots.test.ts`
- Test: `server/test/unit/flightPages.test.ts`

**Interfaces:**
- Consumes: `formatKnots`, `formatNauticalMiles`, `toFeet`, `toKnots`, `KNOTS_PER_MPS` from Task 1.
- Produces: `bandSpeedBoundsKmh` is **replaced** by `bandSpeedBoundsKt(maxSpeedMps: number): BandSpeedBounds[]`, with `BandSpeedBounds` becoming `{ fromKt: number; toKt: number }`. The rename and its only caller land in the same commit, so the repository compiles at every point in the history.
- Produces: the client payload's per-point tuple becomes `[lat, lon, speedMps, seconds, headingDeg, elevFt]` — a **sixth element appended**, because every consumer indexes `p[0]`–`p[4]` literally and inserting in the middle would break them silently. Task 5 relies on that tuple shape and on the DOM ids `r-elev`, `readout-hint`.

- [ ] **Step 1: Write the failing tests**

In `server/test/unit/flightPages.test.ts`, replace the `payloadOf` return type at lines 36-44 with:

```ts
function payloadOf(html: string): {
  startedAt: number;
  points: Array<[number, number, number, number, number, number]>;
  bands: Array<{ band: number; color: string; ranges: Array<[number, number]> }>;
} {
  const match = /var flight = (\{.*?\});/s.exec(html);
  if (!match) throw new Error("The page embeds no flight payload.");
  return JSON.parse(match[1]);
}
```

Replace the `labels the legend with this flight's own speeds` test (lines 129-141) with:

```ts
  it("labels the legend with this flight's own speeds, not a fixed scale", () => {
    // The ramp is relative to the flight's fastest point, so the top of the legend has to be the
    // same number the stats report as the maximum.
    const points = track(300, (i) => (i < 150 ? 10 : 40));
    const flight = summaryFor(points);

    const html = flightDetailPage(flight, points);
    const legend = /<div class="legend"[\s\S]*?<\/div>\s*<\/div>/.exec(html);

    expect(legend).not.toBeNull();
    expect(legend![0]).toContain(String(Math.round(toKnots(flight.maxSpeedMps))));
    expect(legend![0]).toContain("kt");
  });
```

Replace the `gives the legend a text description` test (lines 143-149) with:

```ts
  it("gives the legend a text description rather than colour alone", () => {
    const points = track(60, () => 30);

    const html = flightDetailPage(summaryFor(points), points);

    expect(html).toMatch(/aria-label="[^"]*kt[^"]*"/);
  });
```

Add this import at the top of the file, after the existing imports:

```ts
import { toFeet, toKnots } from "../../src/services/units";
```

Add these tests inside `describe("flightDetailPage", ...)`, before the closing `});` at line 197:

```ts
  it("states distance, speed and elevation in the units an aircraft is flown in", () => {
    const points = track(60, () => 45);

    const html = flightDetailPage(summaryFor(points), points);

    expect(html).toContain("NM");
    expect(html).toContain("87 kt");
    expect(html).toContain("984");
    // Not "km/h appears nowhere" - the GS tile keeps a metric second line, and that is the point.
    // Exactly one occurrence: the primary reading of every quantity is aeronautical.
    expect(html.match(/km\/h/g) ?? []).toHaveLength(1);
  });

  it("keeps the metric reading on the tiles that have one", () => {
    // The same data also gets read from a car. Duración has no unit system, Puntos is a count and
    // Precisión GPS is already metric, so only three tiles carry a second line.
    const points = track(60, () => 45);

    const html = flightDetailPage(summaryFor(points), points);
    const metrics = html.match(/class="stat-metric"/g) ?? [];

    expect(metrics).toHaveLength(3);
    expect(html).toContain("162 km/h");
  });

  it("names the ground speed and the true track rather than airspeed and heading", () => {
    // getSpeed is speed over the ground - there is no pitot tube - and getBearing is relative to
    // true north, so a reader who takes it for a compass heading eats the declination as error.
    const points = track(10);

    const html = flightDetailPage(summaryFor(points), points);

    expect(html).toContain(">GS<");
    expect(html).toContain(">TRK<");
    expect(html).not.toContain(">Rumbo<");
    expect(html).not.toContain(">Velocidad<");
  });

  it("names the elevation for the datum it is actually measured against (Task 4 half)", () => {
    // Not "altitud": it is neither above mean sea level nor pressure altitude, and calling it
    // altitude is the first step toward believing it. The datum itself is stated once, in visible
    // text under the profile - Task 5 renders it and asserts it. Do not add a second statement of
    // it here, and do not hide it in a title attribute: a qualification this load-bearing does not
    // belong somewhere a touch or keyboard reader never reaches.
    const points = track(10);

    const html = flightDetailPage(summaryFor(points), points);

    expect(html).toContain("ELEV GPS");
  });

  it("carries an elevation in feet for every point so the readout can state one", () => {
    const points = track(3);
    points[1].altitudeM = 600;

    const payload = payloadOf(flightDetailPage(summaryFor(points), points));

    expect(payload.points.map((p) => p[5])).toEqual([
      Math.round(toFeet(300)),
      Math.round(toFeet(600)),
      Math.round(toFeet(300)),
    ]);
  });

  it("appends elevation rather than inserting it, so the older readings keep their slots", () => {
    const points = track(3, (i) => 10 + i);

    const payload = payloadOf(flightDetailPage(summaryFor(points), points));

    expect(payload.points[0][2]).toBe(10);
    expect(payload.points[0][4]).toBe(187);
    expect(payload.points[0]).toHaveLength(6);
  });
```

In `describe("flightListPage", ...)`, add before its closing `});`:

```ts
  it("states each flight's top speed in knots", () => {
    const points = track(5, () => 45);

    const html = flightListPage([summaryFor(points)]);

    expect(html).toContain("87 kt");
    expect(html).not.toContain("km/h");
  });
```

Create `server/test/unit/legendKnots.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SPEED_RAMP, bandSpeedBoundsKt } from "../../src/views/theme";
import { toKnots } from "../../src/services/units";

describe("bandSpeedBoundsKt", () => {
  it("gives one bound per ramp step", () => {
    expect(bandSpeedBoundsKt(40)).toHaveLength(SPEED_RAMP.length);
  });

  it("tops out at the flight's own fastest point", () => {
    const bounds = bandSpeedBoundsKt(40);

    expect(bounds[bounds.length - 1].toKt).toBe(Math.round(toKnots(40)));
    expect(bounds[0].fromKt).toBe(0);
  });

  it("stays drawable for a flight that never moved", () => {
    const bounds = bandSpeedBoundsKt(0);

    expect(bounds.every((b) => b.fromKt === 0 && b.toKt === 0)).toBe(true);
  });

  it("leaves no gap or overlap between neighbouring slices", () => {
    // Ported from the bandSpeedBoundsKmh block this rename retires. A legend with a gap between
    // two swatches describes a speed the line can be drawn in but the key does not name.
    const bounds = bandSpeedBoundsKt(50);

    for (let i = 1; i < bounds.length; i++) {
      expect(bounds[i].fromKt).toBe(bounds[i - 1].toKt);
    }
  });
});
```

**`server/test/unit/speedRamp.test.ts` also imports `bandSpeedBoundsKmh`** and will stop compiling
the moment it is renamed. Delete its `describe("bandSpeedBoundsKmh", ...)` block in this same
commit — every assertion in it is now covered by `legendKnots.test.ts` above, including the
gap/overlap one, which is why that test is ported rather than dropped. Leave the rest of
`speedRamp.test.ts` untouched.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && npx vitest run test/unit/flightPages.test.ts test/unit/legendKnots.test.ts
```

Expected: FAIL — `bandSpeedBoundsKt` is not exported, and several `flightPages` tests report `expected ... to contain ">GS<"`.

- [ ] **Step 3: Convert the legend to knots**

In `server/src/views/theme.ts`, add this import as the first line of the file:

```ts
import { toKnots } from "../services/units";
```

Then replace lines 97-117 (`BandSpeedBounds` through the end of `bandSpeedBoundsKmh`) with:

```ts
export interface BandSpeedBounds {
  fromKt: number;
  toKt: number;
}

/**
 * The speed each band stands for, in knots.
 *
 * Bands are relative to the fastest point of the flight being viewed, not to an absolute speed, so
 * the legend has to be computed per flight. Printing one fixed scale under a relative ramp would
 * state something that is not true of the picture above it.
 */
export function bandSpeedBoundsKt(maxSpeedMps: number): BandSpeedBounds[] {
  const maxKt = toKnots(Math.max(maxSpeedMps, 0));
  const step = maxKt / SPEED_RAMP.length;

  return SPEED_RAMP.map((_, band) => ({
    fromKt: Math.round(step * band),
    toKt: Math.round(step * (band + 1)),
  }));
}
```

- [ ] **Step 4: Update the imports and the flight list**

In `server/src/views/flightPages.ts`, replace lines 1-5 with:

```ts
import { escapeHtml, page } from "./layout";
import { SPEED_RAMP, bandColour, bandSpeedBoundsKt } from "./theme";
import type { FlightSummary, TrackPoint } from "../db/flightRepository";
import { trackDistanceMetres } from "../services/flightSegmentation";
import { SPEED_BAND_COUNT, bandTrack } from "../services/trackBanding";
import { KNOTS_PER_MPS, formatKnots, formatNauticalMiles, toFeet } from "../services/units";
```

Replace line 78 (inside `flightListPage`):

```ts
          · máx ${escapeHtml(formatKnots(f.maxSpeedMps))}
```

- [ ] **Step 5: Add elevation to the payload**

Replace the doc comment at lines 95-96 (the "Altitude is deliberately absent" paragraph) with:

```
 * Elevation is here now, in whole feet, appended rather than inserted: every consumer indexes this
 * tuple positionally, so a new slot in the middle would break them without a word. The page states
 * plainly what the value is worth, and the profile draws the evidence alongside it.
```

Replace line 108 (`Math.round(p.headingDeg),`) with:

```ts
      Math.round(p.headingDeg),
      Math.round(toFeet(p.altitudeM)),
```

- [ ] **Step 6: Rewrite the stats, the legend and the readout**

In `flightDetailPage`, replace lines 127-156 (from `const distanceKm` through the end of `stats`) with:

```ts
  const distanceM = trackDistanceMetres(points);
  const accuracies = points.map((p) => p.gpsAccuracyM);
  const medianAccuracy = accuracies.length
    ? [...accuracies].sort((a, b) => a - b)[Math.floor(accuracies.length / 2)]
    : 0;
  const elevations = points.map((p) => p.altitudeM);
  const maxElevM = elevations.length ? Math.max(...elevations) : 0;
  const minElevM = elevations.length ? Math.min(...elevations) : 0;

  const stats = `
    <div class="stats">
      <div>
        <div class="stat-value">${escapeHtml(formatNauticalMiles(distanceM))}
          <span class="stat-metric">${escapeHtml((distanceM / 1000).toFixed(1))} km</span></div>
        <div class="stat-label">Distancia</div>
      </div>
      <div>
        <div class="stat-value">${escapeHtml(durationText(flight.startedAt, flight.endedAt))}</div>
        <div class="stat-label">Duración</div>
      </div>
      <div>
        <div class="stat-value">${escapeHtml(formatKnots(flight.maxSpeedMps))}
          <span class="stat-metric">${escapeHtml(
            (flight.maxSpeedMps * 3.6).toFixed(0)
          )} km/h</span></div>
        <div class="stat-label">GS máx</div>
      </div>
      <div>
        <div class="stat-value">${escapeHtml(points.length.toLocaleString("es-AR"))}</div>
        <div class="stat-label">Puntos</div>
      </div>
      <div>
        <div class="stat-value">±${escapeHtml(medianAccuracy.toFixed(0))} m</div>
        <div class="stat-label">Precisión GPS</div>
      </div>
      <div>
        <div class="stat-value stat-warn">${escapeHtml(Math.round(toFeet(maxElevM)))} /
          ${escapeHtml(Math.round(toFeet(minElevM)))} ft
          <span class="stat-metric">${escapeHtml(maxElevM.toFixed(1))} /
          ${escapeHtml(minElevM.toFixed(1))} m</span></div>
        <div class="stat-label">ELEV GPS máx/mín</div>
      </div>
    </div>`;
```

Replace lines 166-185 (the legend block) with:

```ts
  // The ramp is relative to this flight's fastest point, so the key states this flight's numbers.
  // Three ticks rather than eight: the reader needs the scale, not a number per step.
  const bounds = bandSpeedBoundsKt(flight.maxSpeedMps);
  const topKt = bounds[bounds.length - 1].toKt;
  const legend = `
    <div class="legend" aria-label="Escala de color de la traza, de ${escapeHtml(
      bounds[0].fromKt
    )} a ${escapeHtml(topKt)} kt">
      <span class="legend-title">GS</span>
      <div class="legend-scale">
        <div class="legend-steps" aria-hidden="true">${SPEED_RAMP.map(
          (step) => `<span class="legend-step" style="background: ${escapeHtml(step)}"></span>`
        ).join("")}</div>
        <div class="legend-ticks">
          <span>${escapeHtml(bounds[0].fromKt)}</span>
          <span>${escapeHtml(Math.round(topKt / 2))}</span>
          <span>${escapeHtml(topKt)} kt</span>
        </div>
      </div>
    </div>`;
```

Replace lines 190-207 (the readout and its hint) with:

```ts
      <div class="readout" id="readout" hidden>
        <div class="readout-item">
          <span class="readout-label">Hora</span>
          <span class="readout-value" id="r-time">--:--:--</span>
        </div>
        <div class="readout-item">
          <span class="readout-label">GS</span>
          <span class="readout-value" id="r-speed">--</span>
        </div>
        <div class="readout-item">
          <span class="readout-label">TRK</span>
          <span class="readout-value" id="r-heading">--</span>
        </div>
        <div class="readout-item">
          <span class="readout-label">ELEV GPS</span>
          <span class="readout-value stat-warn" id="r-elev">--</span>
        </div>
      </div>
      <p class="readout-hint" id="readout-hint">
        Mover la barra o pasar el cursor sobre la traza para ver hora, velocidad respecto al suelo,
        derrota verdadera y elevación de cada punto.
      </p>
```

- [ ] **Step 7: Update the client script**

In the inline script, add this line after `var headingCell = document.getElementById('r-heading');` (line 308):

```js
      var elevCell = document.getElementById('r-elev');
```

Replace the body of `show(i)` at lines 326-327 with:

```js
        speedCell.textContent = (p[2] * ${KNOTS_PER_MPS}).toFixed(0) + ' kt';
        headingCell.textContent = p[4] + '\\u00b0';
        elevCell.textContent = p[5] + ' ft';
```

- [ ] **Step 8: Add the two stat classes**

In `server/src/views/layout.ts`, add after line 88 (the closing brace of `.stat-label`):

```css
  /* The same quantity in the unit the operator reads on the ground. Only on the tiles: an
     instrument that restates itself everywhere stops reading like an instrument. */
  .stat-metric { font-size: 14px; font-weight: 400; color: var(--muted); }
  /* The elevation tile, which is not as solid as the five beside it and should not look it. */
  .stat-warn { color: var(--warnInk); }
```

- [ ] **Step 9: Run the tests and the type check**

```bash
cd server && npx vitest run test/unit && npx tsc --noEmit
```

Expected: PASS — every unit test, and `tsc` clean.

- [ ] **Step 10: Commit**

```bash
git add server/src/views/theme.ts server/src/views/flightPages.ts server/src/views/layout.ts server/test/unit/flightPages.test.ts server/test/unit/legendKnots.test.ts
git commit -m "feat(server): read the dashboard in knots, feet and nautical miles"
```

---

### Task 5: The vertical elevation profile

**Files:**
- Modify: `server/src/views/flightPages.ts` (imports, `flightDetailPage` body, the inline script)
- Modify: `server/src/views/layout.ts` (new `.profile*` rules)
- Test: `server/test/unit/flightPages.test.ts`

**Interfaces:**
- Consumes: `profileColumns`, `profileScale` from Task 2; the 6-element payload tuple from Task 4.
- Produces: the DOM ids `profile-cursor` and the classes `profile`, `profile-svg`, `profile-envelope`, `profile-frozen`, `profile-axis`, `profile-ticks`.

- [ ] **Step 1: Write the failing tests**

Add these tests to `describe("flightDetailPage", ...)` in `server/test/unit/flightPages.test.ts`:

```ts
  it("draws the elevation as a profile rather than leaving it to a number", () => {
    const points = track(600);

    const html = flightDetailPage(summaryFor(points), points);

    expect(html).toContain('class="profile-svg"');
    expect(html).toContain('id="profile-cursor"');
    expect(html).toMatch(/class="profile-envelope"/);
  });

  it("states the datum the elevation is measured against, in visible text", () => {
    // "ELEV GPS" alone names nothing a reader can check. The qualification lives here, once, in
    // the profile note - not in a title attribute a touch or keyboard reader never reaches.
    const points = track(600);

    const html = flightDetailPage(summaryFor(points), points);
    const note = /<span class="profile-note">([\s\S]*?)<\/span>/.exec(html);

    expect(note).not.toBeNull();
    expect(note![1]).toContain("WGS84");
  });

  it("shades the profile where the recorded value simply repeated", () => {
    // The fixture track never changes altitude, which is exactly the ground behaviour the warning
    // describes. Every column should be shaded at full strength.
    const points = track(600);

    const html = flightDetailPage(summaryFor(points), points);
    const shading = html.match(/class="profile-frozen" fill-opacity="([\d.]+)"/g) ?? [];

    expect(shading.length).toBeGreaterThan(0);
    expect(html).toContain('fill-opacity="0.550"');
  });

  it("leaves the profile unshaded when the value actually moves", () => {
    const points = track(600, () => 30);
    points.forEach((p, i) => {
      p.altitudeM = 300 + i;
    });

    const html = flightDetailPage(summaryFor(points), points);

    expect(html).not.toContain('class="profile-frozen"');
  });

  it("scales a flat profile to the floor instead of magnifying the quantisation", () => {
    // 0.3 m of recorded variation. Autoscaled, 10 cm of noise would fill the frame.
    const points = track(600);
    points.forEach((p, i) => {
      p.altitudeM = 300 + (i % 4) * 0.1;
    });

    const html = flightDetailPage(summaryFor(points), points);
    const axis = /<div class="profile-axis">([\s\S]*?)<\/div>/.exec(html);

    expect(axis).not.toBeNull();
    const labels = (axis![1].match(/-?\d+/g) ?? []).map(Number);
    expect(Math.max(...labels) - Math.min(...labels)).toBe(100);
  });

  it("omits the profile for a flight that has no shape to draw", () => {
    const points = track(1);

    const html = flightDetailPage(summaryFor(points), points);

    expect(html).not.toContain('class="profile-svg"');
  });

  it("keeps the map, the profile and the inspector in that order as one card", () => {
    const points = track(120);

    const html = flightDetailPage(summaryFor(points), points);

    expect(html.indexOf('id="map"')).toBeLessThan(html.indexOf('class="profile"'));
    expect(html.indexOf('class="profile"')).toBeLessThan(html.indexOf('class="inspector"'));
  });

  it("no longer claims the altitude is not graphed, but still says it is not trustworthy", () => {
    const points = track(10);

    const html = flightDetailPage(summaryFor(points), points);

    expect(html).toContain("no es confiable");
    expect(html).not.toContain("no se grafica");
    expect(html).toContain("sombreada");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && npx vitest run test/unit/flightPages.test.ts
```

Expected: FAIL — `expected ... to contain 'class="profile-svg"'`.

- [ ] **Step 3: Import the reduction and add its constants**

In `server/src/views/flightPages.ts`, add to the imports:

```ts
import { profileColumns, profileScale } from "../services/verticalProfile";
```

Add after the `HOUR_CYCLE` constant (line 27):

```ts
/**
 * Finer than one column per pixel at the page's 960px maximum, and capped by profileColumns to the
 * sample count so a short flight simply produces fewer.
 */
const PROFILE_COLUMNS = 720;

/** The SVG's viewBox height, and its CSS height in pixels - so one y unit is one pixel. */
const PROFILE_HEIGHT = 120;
```

- [ ] **Step 4: Build the profile block**

In `flightDetailPage`, insert this immediately before the `const head = ...` declaration:

```ts
  const columns = profileColumns(points, PROFILE_COLUMNS);
  const scale = profileScale(columns);
  const spanFt = scale.maxFt - scale.minFt;
  const yOf = (ft: number): number => ((scale.maxFt - ft) / spanFt) * PROFILE_HEIGHT;

  // Full-height bands behind the trace, tinted by how much of the column repeated. Drawn first so
  // the trace stays on top of its own caveat rather than under it.
  const frozenBands = columns
    .filter((c) => c.sampleCount > 0 && c.frozenFraction > 0)
    .map(
      (c) =>
        `<rect class="profile-frozen" fill-opacity="${escapeHtml(
          (c.frozenFraction * 0.55).toFixed(3)
        )}" x="${escapeHtml(c.x)}" y="0" width="1" height="${escapeHtml(PROFILE_HEIGHT)}"/>`
    )
    .join("");

  // One rect per column, and columns a coverage gap left empty are simply skipped: a line drawn
  // across a gap is a measurement nobody took. A floor of 1.5 units keeps a flat column visible
  // instead of collapsing it to nothing.
  const envelope = columns
    .filter((c) => c.sampleCount > 0)
    .map((c) => {
      const top = yOf(c.maxFt);
      const height = Math.max(yOf(c.minFt) - top, 1.5);
      return `<rect class="profile-envelope" x="${escapeHtml(c.x)}" y="${escapeHtml(
        top.toFixed(2)
      )}" width="1" height="${escapeHtml(height.toFixed(2))}"/>`;
    })
    .join("");

  const midInstant = new Date((flight.startedAt.getTime() + flight.endedAt.getTime()) / 2);

  // Tick labels live in HTML around the SVG, never inside it: the viewBox stretches to the card's
  // width with preserveAspectRatio="none", which would stretch any text drawn in it with it.
  const profile =
    columns.length === 0
      ? ""
      : `
    <div class="profile">
      <div class="profile-head">
        <span class="profile-title">ELEV GPS</span>
        <span class="profile-note">sobre elipsoide WGS84 · las franjas sombreadas repiten el valor
          del fix anterior</span>
      </div>
      <div class="profile-plot">
        <svg class="profile-svg" viewBox="0 0 ${escapeHtml(columns.length)} ${escapeHtml(
          PROFILE_HEIGHT
        )}" preserveAspectRatio="none" role="img"
             aria-label="Perfil de elevación GPS, de ${escapeHtml(
               Math.round(scale.minFt)
             )} a ${escapeHtml(Math.round(scale.maxFt))} pies. Las franjas sombreadas marcan los
             tramos donde el valor registrado repite el del fix anterior.">
          ${frozenBands}
          ${envelope}
          <line class="profile-cursor" id="profile-cursor" vector-effect="non-scaling-stroke"
                x1="0" y1="0" x2="0" y2="${escapeHtml(PROFILE_HEIGHT)}" hidden/>
        </svg>
        <div class="profile-axis">
          <span>${escapeHtml(Math.round(scale.maxFt))} ft</span>
          <span>${escapeHtml(Math.round((scale.minFt + scale.maxFt) / 2))}</span>
          <span>${escapeHtml(Math.round(scale.minFt))}</span>
        </div>
      </div>
      <div class="profile-ticks">
        <span>${escapeHtml(localTime(flight.startedAt))}</span>
        <span>${escapeHtml(localTime(midInstant))}</span>
        <span>${escapeHtml(localTime(flight.endedAt))}</span>
      </div>
    </div>`;
```

- [ ] **Step 5: Place it in the body and rewrite the warning**

Replace the body's `${stats}` through the closing `</div>` of the warning (lines 222-232) with:

```ts
    ${stats}
    <div id="map"></div>
    ${profile}
    ${inspector}
    <div class="warning">
      <strong>La altitud de este vuelo no es confiable.</strong>
      El valor que registra el sistema viene en escalones de 10 cm, resultó idéntico bit a bit entre
      dos teléfonos distintos en el mismo lugar, y no cambió en el 63% de los fixes consecutivos
      estando quieto — con el GPS declarando ±15 m de error. Sigue el terreno, que en tierra es
      indistinguible de la altura real y deja de serlo apenas el avión despega. Por eso el perfil se
      dibuja con esa evidencia encima: donde el valor repite el del fix anterior, la franja está
      sombreada. En tierra eso cubre casi todo el recorrido. Si en un vuelo real esas marcas
      desaparecen, el número es una medición y no un modelo de terreno.
    </div>
```

- [ ] **Step 6: Move the cursor from the existing readout funnel**

In the inline script, add after `var elevCell = document.getElementById('r-elev');`:

```js
      var profileCursor = document.getElementById('profile-cursor');
      var profileColumns = ${columns.length};
      var profileSeconds = points.length > 1 ? points[points.length - 1][3] : 0;
```

Add inside `show(i)`, immediately before `if (scrub && scrub.value !== String(i)) scrub.value = i;`:

```js
        if (profileCursor && profileSeconds > 0) {
          // The cursor is placed in viewBox units, which are columns - so the same number of
          // seconds always lands on the same column whatever width the card ends up.
          var profileX = (p[3] / profileSeconds) * profileColumns;
          profileCursor.setAttribute('x1', profileX);
          profileCursor.setAttribute('x2', profileX);
          // removeAttribute, not .hidden: hidden is an HTMLElement property, and an SVG element
          // would take the assignment as an expando and never show the line.
          profileCursor.removeAttribute('hidden');
        }
```

- [ ] **Step 7: Style the profile**

In `server/src/views/layout.ts`, add after the `#map` rule (line 89):

```css

  /* The middle piece of the map card: the map rounds its top, the inspector rounds its bottom, and
     this joins them with no radius of its own. */
  .profile {
    background: var(--surface);
    border: 1px solid var(--border);
    border-top: 0;
    padding: 12px 16px 10px;
  }
  .profile-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .profile-title {
    font-size: 12px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: .04em;
  }
  .profile-note { font-size: 12px; color: var(--muted); }
  .profile-plot { display: flex; align-items: stretch; gap: 8px; }
  /* The viewBox is one unit per column and 120 tall, stretched to whatever width the card has -
     so nothing the server draws needs to know the rendered pixel width. */
  .profile-svg { flex: 1; min-width: 0; height: 120px; display: block; }
  .profile-envelope { fill: var(--profileInk); }
  .profile-frozen { fill: var(--profileFrozen); }
  .profile-cursor { stroke: var(--ink); stroke-width: 1; }
  .profile-axis {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    text-align: right;
    font-size: 12px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .profile-ticks {
    display: flex;
    justify-content: space-between;
    margin-top: 3px;
    font-size: 12px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
```

- [ ] **Step 8: Run the tests and the type check**

```bash
cd server && npx vitest run test/unit && npx tsc --noEmit
```

Expected: PASS — every unit test, `tsc` clean.

- [ ] **Step 9: Commit**

```bash
git add server/src/views/flightPages.ts server/src/views/layout.ts server/test/unit/flightPages.test.ts
git commit -m "feat(server): graph the elevation profile with its frozen samples marked"
```

---

### Task 6: The profile against a real database

**Files:**
- Modify: `server/test/integration/dashboard.test.ts:113-160` (the `GET /flights/:deviceId/:at` block)

**Interfaces:**
- Consumes: everything from Tasks 1-5. Produces nothing.

- [ ] **Step 1: Write the failing tests**

The fixture at `dashboard.test.ts:30` inserts `altitude_m` as the literal `300` for every row, so a real flight from it is entirely frozen — which is exactly the ground behaviour the warning describes, and the strongest assertion available here.

Add these tests inside `describe("GET /flights/:deviceId/:at", ...)`, after the `says plainly that the altitude cannot be trusted` test:

```ts
    it("draws the elevation profile from real rows", async () => {
      const list = await request(app).get("/api/flights");
      const flight = ourFlights(list.body)[0] as never & { started_at: string };

      const res = await request(app).get(`/flights/${deviceId}/${Date.parse(flight.started_at)}`);

      expect(res.text).toContain('class="profile-svg"');
      expect(res.text).toContain('class="profile-envelope"');
    });

    it("shades a fixture whose elevation never moves as entirely frozen", async () => {
      // Every row in this fixture carries altitude_m = 300, which is the stuck-value signature the
      // warning describes. If the shading does not appear here, it will not appear anywhere.
      const list = await request(app).get("/api/flights");
      const flight = ourFlights(list.body)[0] as never & { started_at: string };

      const res = await request(app).get(`/flights/${deviceId}/${Date.parse(flight.started_at)}`);

      expect(res.text).toContain('fill-opacity="0.550"');
    });

    it("reads the whole page in aviation units", async () => {
      const list = await request(app).get("/api/flights");
      const flight = ourFlights(list.body)[0] as never & { started_at: string };

      const res = await request(app).get(`/flights/${deviceId}/${Date.parse(flight.started_at)}`);

      expect(res.text).toContain("NM");
      expect(res.text).toContain("kt");
      expect(res.text).toContain("ELEV GPS");
    });
```

- [ ] **Step 2: Run the suite to verify the new tests fail before Tasks 1-5 land**

If Tasks 1-5 are already committed, these pass immediately — that is expected, and this task is then a verification step rather than a red-green cycle. Run:

```bash
cd server && npm test
```

Expected: PASS — the full suite, unit and integration. `npm test` provisions its own Postgres; no database needs to be running first.

- [ ] **Step 3: Verify the page in a browser**

```bash
cd server && npm run dev
```

Open a flight from the list and confirm three things the tests cannot: the profile spans the card's full width with no horizontal scrollbar, the cursor line tracks the scrub slider and the map hover together, and the whole card still reads correctly with the OS switched to dark mode.

- [ ] **Step 4: Commit**

```bash
git add server/test/integration/dashboard.test.ts
git commit -m "test(server): assert the elevation profile renders from real telemetry"
```

---

## Definition of done

- `cd server && npm test` passes — unit and integration.
- `cd server && npx tsc --noEmit` is clean.
- The flight page shows six stat tiles, a knots legend, a vertical profile with shaded frozen bands, and a readout with Hora / GS / TRK / ELEV GPS.
- No string `km/h` remains outside the three `.stat-metric` spans; no string `no se grafica` remains anywhere.
