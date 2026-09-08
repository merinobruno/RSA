/**
 * Plain template functions returning HTML strings. No template engine: the dashboard is two pages,
 * and a dependency that renders them would be larger than they are.
 *
 * Everything interpolated goes through [escapeHtml] without exception. Device labels are operator
 * input and flight data comes from the database, so neither is trusted here on principle rather
 * than on an assessment of who can currently write to them.
 */

export function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&#39;", '"': "&quot;" })[c] as string
  );
}

const STYLES = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #fafafa;
    color: #212121;
  }
  header {
    background: #0d2a54;
    color: #fff;
    padding: 16px 20px;
  }
  header h1 { margin: 0; font-size: 20px; }
  header a { color: #9fc4ff; text-decoration: none; font-size: 14px; }
  main { max-width: 960px; margin: 0 auto; padding: 20px; }
  .flight {
    display: block;
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    padding: 14px 16px;
    margin-bottom: 10px;
    text-decoration: none;
    color: inherit;
  }
  .flight:hover { border-color: #0288d1; }
  .flight-label { font-weight: 600; font-size: 17px; }
  .flight-when { color: #616161; font-size: 14px; }
  .stats { display: flex; flex-wrap: wrap; gap: 20px; margin: 12px 0 18px; }
  .stat-value { font-size: 24px; font-weight: 600; }
  .stat-label { font-size: 13px; color: #616161; text-transform: uppercase; letter-spacing: .04em; }
  #map { height: 62vh; min-height: 340px; border-radius: 8px; border: 1px solid #e0e0e0; }
  .warning {
    background: #fff8e1;
    border: 1px solid #f0d488;
    border-radius: 8px;
    padding: 12px 14px;
    margin: 18px 0;
    font-size: 14px;
    color: #5d4409;
  }
  .warning strong { display: block; margin-bottom: 4px; }
  .empty { color: #616161; }
  @media (prefers-color-scheme: dark) {
    body { background: #121212; color: #e0e0e0; }
    .flight { background: #1e1e1e; border-color: #333; }
    .warning { background: #2b2418; border-color: #4a3c1a; color: #e8d9b0; }
    #map { border-color: #333; }
  }
`;

export function page(title: string, body: string, headExtra = ""): string {
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
  <h1><a href="/" style="color:#fff;text-decoration:none">RSA · seguimiento de vuelos</a></h1>
</header>
<main>${body}</main>
</body>
</html>`;
}
