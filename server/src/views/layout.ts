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
  body {
    margin: 0;
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
  .flight {
    display: block;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 16px;
    margin-bottom: 10px;
    text-decoration: none;
    color: inherit;
  }
  .flight:hover { border-color: var(--accent); }
  .flight-label { font-weight: 600; font-size: 17px; }
  .flight-when { color: var(--muted); font-size: 14px; }
  .stats { display: flex; flex-wrap: wrap; gap: 20px; margin: 12px 0 18px; }
  .stat-value { font-size: 24px; font-weight: 600; }
  .stat-label {
    font-size: 13px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: .04em;
  }
  #map { height: 56vh; min-height: 320px; border-radius: 8px 8px 0 0; border: 1px solid var(--border); }

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
