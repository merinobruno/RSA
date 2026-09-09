/**
 * Plain template functions returning HTML strings. No template engine: the dashboard is two pages,
 * and a dependency that renders them would be larger than they are.
 *
 * Everything interpolated goes through [escapeHtml] without exception. Device labels are operator
 * input and flight data comes from the database, so neither is trusted here on principle rather
 * than on an assessment of who can currently write to them.
 */

import { DARK, HEADER, LIGHT, cssVariables } from "./theme";

export function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&#39;", '"': "&quot;" })[c] as string
  );
}

const STYLES = `
  :root {
    color-scheme: light dark;
    ${cssVariables(LIGHT)}
    --header-bg: ${HEADER.bg};
    --header-ink: ${HEADER.ink};
    --header-link: ${HEADER.link};
    /* The logbook's numeric columns: duration, distance, top speed, packet count. */
    --nums: 3.2rem 3.4rem 3.6rem 4.4rem;
  }
  /* Only the tokens change between themes. Every rule below reads them, so no colour is stated
     twice and none can drift out of the contrast the palette was measured for. */
  @media (prefers-color-scheme: dark) {
    :root {
    ${cssVariables(DARK)}
    }
  }
  * { box-sizing: border-box; }
  /* The browser's own [hidden] rule is a user-agent style, so any author display declaration beats
     it - and .readout sets display:flex. Without this, hiding the readout does nothing at all. */
  [hidden] { display: none !important; }

  /* The parts nobody draws still ship with the page. A browser-default selection colour and a
     browser-default scrollbar belong to no design system, and theming them from the palette is
     the cheapest evidence that this page was built rather than assembled. */
  ::selection { background: var(--accent); color: var(--surface); }
  ::-webkit-scrollbar { width: 12px; height: 12px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: var(--border);
    border: 3px solid var(--bg);
    border-radius: 7px;
  }
  ::-webkit-scrollbar-thumb:hover { background: var(--muted); }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
  }
  body {
    margin: 0;
    scrollbar-color: var(--border) transparent;
    scrollbar-width: thin;
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    background: var(--bg);
    color: var(--ink);
  }
  header {
    background: var(--header-bg);
    color: var(--header-ink);
    padding: 16px 20px;
    display: flex;
    align-items: baseline;
    gap: 16px;
    flex-wrap: wrap;
  }
  header h1 { margin: 0; font-size: 20px; }
  header h1 a { color: var(--header-ink); text-decoration: none; }
  .back {
    color: var(--header-link);
    font-size: 14px;
    text-decoration: none;
    border-bottom: 1px solid currentColor;
  }
  .back:hover { color: var(--header-ink); }
  main { max-width: 960px; margin: 0 auto; padding: 20px; }
  h2 { font-size: 22px; margin: 0 0 14px; }
  a:focus-visible, input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .flight-when { color: var(--muted); font-size: 14px; }

  /* ---- The flight index, as a logbook -------------------------------------------------------
     Ruled lines and aligned columns rather than a grid of cards. A logbook is the artifact this
     reader already knows, and it is built for the thing the card list was bad at: running an eye
     down thirty entries. Hairlines do the separating, so no entry needs a box of its own. */

  .fleet { margin: 0 0 20px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
  .fleet-summary {
    display: flex;
    align-items: baseline;
    gap: 8px 14px;
    flex-wrap: wrap;
    cursor: pointer;
    padding: 2px 8px 2px 0;
    list-style: none;
  }
  /* Safari draws its own marker through a pseudo-element the standard rule does not reach. */
  .fleet-summary::-webkit-details-marker { display: none; }
  .fleet-summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .fleet-title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: .09em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .fleet-tally { display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap; font-size: 13px; }
  .fleet-count { color: var(--muted); font-variant-numeric: tabular-nums; }
  .fleet-count--live { color: var(--live); font-weight: 600; }
  .fleet-count--silent { color: var(--warnInk); font-weight: 600; }
  /* Muted, not --border: at 1.2:1 against the ground the separator was drawn and invisible. */
  .fleet-sep { color: var(--muted); }
  /* A caret drawn from the palette rather than a glyph borrowed from a font, and it turns with the
     disclosure so the control says which way it is going. */
  .fleet-summary::after {
    content: "";
    width: 7px;
    height: 7px;
    margin-left: auto;
    border-right: 1.5px solid var(--muted);
    border-bottom: 1.5px solid var(--muted);
    transform: rotate(45deg) translateY(-1px);
    transition: transform .18s cubic-bezier(.16, 1, .3, 1);
  }
  .fleet-details[open] .fleet-summary::after { transform: rotate(-135deg) translateY(-1px); }
  .fleet-list {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 6px 26px;
  }
  .fleet-item {
    display: grid;
    grid-template-columns: 7px minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 9px;
    font-size: 14px;
  }
  .fleet-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .fleet-light {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--muted);
    transform: translateY(-2px);
  }
  .fleet-item--live .fleet-light { background: var(--live); }
  /* Hollow rather than red-filled: a phone that has gone quiet is a thing to look at, not an
     alarm, and the words beside it already say how long it has been. */
  .fleet-item--silent .fleet-light { background: none; box-shadow: inset 0 0 0 1.5px var(--warnInk); }
  .fleet-signal { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
  .fleet-item--live .fleet-signal { color: var(--live); }
  .fleet-item--silent .fleet-signal { color: var(--warnInk); }

  /* The entry that has not been closed yet: the same grammar as the rows below, one step larger,
     ruled top and bottom instead of boxed. */
  .open { margin: 0 0 4px; }
  .open-entry {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 12px 20px;
    align-items: center;
    padding: 15px 8px 17px;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    text-decoration: none;
    color: inherit;
  }
  /* The one distinguishing mark of an open line is that it has no closing rule. A flight still
     sending packets gets the live rule above and nothing below; a finished one is ruled on both
     sides, because it is a closed entry. Without this the metaphor the whole page is built on was
     never actually drawn. */
  .open--live .open-entry { border-top: 2px solid var(--live); border-bottom: 0; }
  /* Pending is open as well - the page is saying nothing has closed this flight - so it loses its
     closing rule too, in the colour its own label carries rather than the live green it has not
     earned. */
  .open--pending .open-entry { border-top: 2px solid var(--warnInk); border-bottom: 0; }
  .open-entry:hover { background: var(--surface); }
  .open-entry:hover .open-craft { text-decoration: underline; text-underline-offset: 3px; }
  .open-status {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .open-live, .open-last, .open-pending {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: .08em;
    text-transform: uppercase;
  }
  .open-live { color: var(--live); }
  .open-last { color: var(--muted); }
  .open-pending { color: var(--warnInk); }
  .open-age { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
  .open-craft { display: block; font-size: 19px; font-weight: 600; }
  .open-when { display: block; color: var(--muted); font-size: 14px; }
  /* Close to the ledger's own scale, and carrying no captions of its own: the column header
     directly below names these, and giving them large numerals over small labels turned the open
     line into the metric panel this design refuses. */
  .open-figures .cell--num { font-size: 16px; font-weight: 600; }

  .day-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px 14px;
    flex-wrap: wrap;
    margin: 24px 0 3px;
    padding: 0 8px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: .07em;
    text-transform: uppercase;
    color: var(--muted);
  }
  /* A logbook foots every page. The total is what turns the heading from a label into a fact the
     reader can check against the rows underneath it. */
  .day-total { font-weight: 400; letter-spacing: .02em; font-variant-numeric: tabular-nums; }

  /* One template, shared by the header and every row, is what makes the columns read as columns
     all the way down the page and across the date groups. */
  .rows-head, .entry {
    display: grid;
    grid-template-columns: 3.6rem 30px minmax(0, 1fr) auto;
    gap: 0 16px;
    align-items: center;
  }
  /* One template, shared by the ledger's rows, its header, and the open entry's figures, so the
     open line's numbers land directly above the columns they belong to. Stated once because three
     copies of it would drift the first time one column needed another quarter of an em. */
  .cell-nums, .open-figures {
    display: grid;
    grid-template-columns: var(--nums);
    gap: 0 16px;
  }
  .cell-nums { align-items: baseline; }
  /* Sticky, because a thirty-entry ledger scrolls its only key off the screen otherwise, and the
     per-cell unit spans that rescue the narrow layout are hidden at this width. It needs its own
     opaque ground, or the rows travel through it.

     No backticks in this comment, or any comment in this file: the whole stylesheet is a template
     literal, and a backtick here ends it and turns the next CSS selector into a property access. */
  .rows-head {
    position: sticky;
    top: 0;
    z-index: 1;
    margin-top: 22px;
    background: var(--bg);
    padding: 9px 8px 7px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: .07em;
    text-transform: uppercase;
    color: var(--muted);
    border-bottom: 1px solid var(--border);
  }
  .rows { list-style: none; margin: 0; padding: 0; }
  .row + .row { border-top: 1px solid var(--border); }
  .entry {
    padding: 10px 8px;
    text-decoration: none;
    color: inherit;
    border-radius: 5px;
  }
  /* The background swap alone is 1.02:1 in the light theme, and an inset hairline in --border is
     1.27:1 against the ground - the same contrast this file rejects for the roster separator, in a
     value the resting rows already carry as their rules. So the mark is an underline on the
     aircraft name: full ink contrast, and the conventional affordance for what this row actually
     is, which is a link. */
  .entry:hover { background: var(--surface); }
  .entry:hover .cell--craft { text-decoration: underline; text-underline-offset: 3px; }
  .cell { min-width: 0; }
  .cell--time { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .cell--craft { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cell--num { text-align: right; font-size: 14px; font-variant-numeric: tabular-nums; }
  .cell--faint { color: var(--muted); }
  .cell--glyph { display: flex; }
  /* The header names each column, so the rows carry bare numerals. The narrow layout hides the
     header, and turns these on instead. */
  .u { display: none; }

  .glyph { display: block; flex: none; width: 30px; height: 30px; }
  .glyph--lg { width: 62px; height: 62px; }
  .glyph--none { width: 30px; height: 30px; }
  .glyph-line {
    fill: none;
    stroke: var(--profileInk);
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .glyph--lg .glyph-line { stroke-width: 1.9; }
  .glyph-start { fill: var(--ink); }
  .open--live .glyph-line { stroke: var(--live); }
  .open--live .glyph-start { fill: var(--live); }

  .auto { margin: 26px 0 0; color: var(--muted); font-size: 13px; }

  /* The one authored motion on this page: a ring leaving the live dot, once every couple of
     seconds. The dot itself never animates, so nothing the reader needs is ever mid-fade. */
  .open-pulse {
    position: relative;
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--live);
  }
  .open-pulse::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: var(--live);
    animation: live-ping 2.6s cubic-bezier(.16, 1, .3, 1) infinite;
  }
  /* Transform and opacity only. A growing box-shadow repaints the ring on every frame for as long
     as the flight lasts; a scaled pseudo-element is handed to the compositor once. */
  @keyframes live-ping {
    0%   { transform: scale(1);   opacity: .5; }
    70%  { transform: scale(3.4); opacity: 0; }
    100% { transform: scale(3.4); opacity: 0; }
  }

  @media (max-width: 620px) {
    .rows-head { display: none; }
    .entry {
      grid-template-columns: 30px minmax(0, 1fr) auto;
      gap: 4px 12px;
      padding: 11px 8px;
    }
    .cell--glyph { grid-column: 1; grid-row: 1 / span 2; align-self: center; }
    .cell--craft { grid-column: 2; grid-row: 1; font-weight: 600; }
    .cell--time { grid-column: 3; grid-row: 1; text-align: right; }
    .cell-nums {
      grid-column: 2 / -1;
      grid-row: 2;
      grid-template-columns: repeat(4, auto);
      justify-content: start;
      gap: 0 18px;
    }
    .cell--num { text-align: left; }
    .u { display: inline; margin-left: 2px; font-size: 11px; color: var(--muted); }
    .open-entry { grid-template-columns: auto minmax(0, 1fr); gap: 10px 16px; }
    /* Every row placed explicitly. Left to auto-placement the figures landed above the aircraft
       they belong to, which inverts the reading order: what is happening, which aircraft, then
       the numbers. */
    .open-status { grid-row: 1; }
    .open-glyph { grid-row: 2; grid-column: 1; }
    .open-body { grid-row: 2; grid-column: 2; }
    .open-figures {
      grid-row: 3;
      grid-column: 1 / -1;
      text-align: left;
      grid-template-columns: repeat(4, auto);
      justify-content: start;
      gap: 0 22px;
    }
    .open-craft { font-size: 18px; }
    .glyph--lg { width: 48px; height: 48px; }
    /* One device per line: the labels are registrations and aircraft types, and breaking one
       across two lines makes a roster you have to read twice. */
    .fleet-list { grid-template-columns: 1fr; gap: 7px 0; }
    .fleet-tally { font-size: 12px; }
  }
  .stats { display: flex; flex-wrap: wrap; gap: 20px; margin: 12px 0 18px; }
  .stat-value { font-size: 24px; font-weight: 600; }
  .stat-label {
    font-size: 13px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: .04em;
  }
  /* The same quantity in the unit the operator reads on the ground. Only on the tiles: an
     instrument that restates itself everywhere stops reading like an instrument. */
  .stat-metric { font-size: 14px; font-weight: 400; color: var(--muted); }
  /* The elevation tile, which is not as solid as the five beside it and should not look it. */
  .stat-warn { color: var(--warnInk); }
  #map { height: 56vh; min-height: 320px; border-radius: 8px 8px 0 0; border: 1px solid var(--border); }

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

  /* The inspector sits under the map rather than floating over it: it never hides the track, it
     needs no stacking order against Leaflet's own panes, and on a narrow screen it has room to
     state a full line instead of being squeezed into a corner. */
  .inspector {
    background: var(--surface);
    border: 1px solid var(--border);
    border-top: 0;
    border-radius: 0 0 8px 8px;
    padding: 12px 16px 14px;
  }
  .legend {
    display: flex;
    align-items: center;
    gap: 8px 14px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .legend-title {
    font-size: 12px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: .04em;
  }
  .legend-scale { flex: 1 1 200px; max-width: 420px; }
  .legend-steps { display: flex; height: 10px; border-radius: 5px; overflow: hidden; }
  .legend-step { flex: 1; }
  .legend-ticks {
    display: flex;
    justify-content: space-between;
    margin-top: 3px;
    font-size: 12px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .readout {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 22px;
    align-items: baseline;
    min-height: 30px;
  }
  .readout-item { display: flex; align-items: baseline; gap: 6px; }
  .readout-label {
    font-size: 12px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: .04em;
  }
  .readout-value { font-size: 19px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .readout-hint { color: var(--muted); font-size: 14px; }
  .scrub {
    width: 100%;
    margin: 10px 0 0;
    accent-color: var(--accent);
  }
  .warning {
    background: var(--warnBg);
    border: 1px solid var(--warnBorder);
    border-radius: 8px;
    padding: 12px 14px;
    margin: 18px 0;
    font-size: 14px;
    color: var(--warnInk);
  }
  .warning strong { display: block; margin-bottom: 4px; }
  .empty { color: var(--muted); }
`;

export function page(title: string, body: string, headExtra = "", backHref = ""): string {
  const back = backHref
    ? `<a class="back" href="${escapeHtml(backHref)}">&larr; Todos los vuelos</a>`
    : "";

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- Not access control - the operator chose a public URL knowingly - but keeping the tracks out
     of search results costs nothing and stops them being found by someone not given the link. -->
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
${headExtra}
</head>
<body>
<header>
  <h1><a href="/">RSA · seguimiento de vuelos</a></h1>
  ${back}
</header>
<main>${body}</main>
</body>
</html>`;
}
