import { writeFileSync } from "fs";
import { closePool, getPool } from "../db/pool";

/**
 * Exports one device's telemetry as KML, for Google Earth or Google My Maps.
 *
 *   npm run export:kml -- <device_id> [output.kml] [--since 2026-09-06T00:00:00Z] [--limit 5000]
 *                        [--simple]
 *
 * Reads the database directly rather than going through the HTTP API, for one decisive reason:
 * the API needs that device's key, and a key cannot be recovered once issued - only its hash is
 * stored. An operator who lost it could never export their own flight. DATABASE_URL always works.
 *
 * The output contains the same track twice, in folders you can toggle independently:
 *
 *   - "Track (animated)" is a gx:Track, the KML element built for a moving object. Google Earth
 *     gives it a time slider, so you can replay the flight rather than stare at a static line.
 *   - "Path" is a plain LineString, which every KML viewer understands, including Google My Maps
 *     and anything that ignores the gx: extensions.
 *
 * `--simple` emits only that second form. Google My Maps imports the full file perfectly well but
 * warns "Unsupported element" for gx:Track and TimeStamp, and a tool that greets you with warnings
 * every time trains you to ignore warnings. Use --simple when the destination is My Maps, and the
 * default when it is Google Earth, where the animation is the whole point.
 *
 * Altitude is deliberately clamped to the ground. The altitude this system currently records does
 * not track real elevation (see the project notes), and drawing a track at a height known to be
 * wrong produces a confident, readable, false picture - worse than not drawing it at all. Revisit
 * once the altitude source is fixed.
 */

interface TelemetryRow {
  packet_id: string;
  captured_at: Date;
  lat: number;
  lon: number;
  altitude_m: number;
  gps_accuracy_m: number;
  speed_mps: number;
  heading_deg: number;
  battery_pct: number;
}

function xmlEscape(value: unknown): string {
  return String(value).replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] as string
  );
}

/** Straight-line distance between two fixes in metres. Fine for a track sampled every 30s. */
function metresBetween(a: TelemetryRow, b: TelemetryRow): number {
  const dLat = (b.lat - a.lat) * 111320;
  const dLon = (b.lon - a.lon) * 111320 * Math.cos((b.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const positional = args.filter(
    (a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--"))
  );

  const deviceId = positional[0];
  const outPath = positional[1] ?? "track.kml";
  const since = flag("since");
  // Raised when capture went to 1 Hz: the old 10,000 was under three hours of flight, so a longer
  // one would have been truncated. Silently, which is the part that mattered - see the warning
  // below.
  const limit = Number(flag("limit") ?? 50000);
  const simple = args.includes("--simple");

  if (!deviceId) {
    throw new Error(
      "usage: npm run export:kml -- <device_id> [output.kml] [--since <iso8601>] [--limit <n>]"
    );
  }

  const params: unknown[] = [deviceId];
  let where = "device_id = $1";
  if (since) {
    params.push(since);
    where += ` AND captured_at >= $${params.length}`;
  }
  params.push(limit);

  const { rows } = await getPool().query<TelemetryRow>(
    `SELECT packet_id, captured_at, lat, lon, altitude_m, gps_accuracy_m, speed_mps,
            heading_deg, battery_pct
     FROM telemetry
     WHERE ${where}
     ORDER BY captured_at ASC
     LIMIT $${params.length}`,
    params
  );

  const deviceRows = await getPool().query<{ label: string }>(
    "SELECT label FROM devices WHERE id = $1",
    [deviceId]
  );

  if (rows.length === 0) {
    throw new Error(
      `No telemetry found for device ${deviceId}${since ? ` since ${since}` : ""}.`
    );
  }

  const label = deviceRows.rows[0]?.label ?? deviceId;
  const iso = (d: Date) => new Date(d).toISOString();

  // Hitting the limit exactly almost certainly means the track was cut short. A truncated export
  // looks like a complete one - the line just ends somewhere plausible - so this has to be said
  // out loud rather than left for someone to notice on the map.
  if (rows.length === limit) {
    console.warn(
      `WARNING: hit the ${limit}-row limit, so this track is probably TRUNCATED.\n` +
        `         Narrow it with --since <iso8601>, or raise --limit.\n`
    );
  }

  let metres = 0;
  for (let i = 1; i < rows.length; i++) metres += metresBetween(rows[i - 1], rows[i]);
  const maxSpeed = Math.max(...rows.map((r) => Number(r.speed_mps)));

  const summary = [
    `Device: ${label}`,
    `Packets: ${rows.length}`,
    `From: ${iso(rows[0].captured_at)}`,
    `To: ${iso(rows[rows.length - 1].captured_at)}`,
    `Distance: ${(metres / 1000).toFixed(2)} km`,
    `Max speed: ${maxSpeed.toFixed(1)} m/s (${(maxSpeed * 3.6).toFixed(0)} km/h)`,
    "",
    "Altitude is clamped to the ground on purpose: the recorded altitude does not currently",
    "track real elevation, so drawing it would be confidently wrong.",
  ].join("\n");

  const simpleArray = (name: string, values: Array<string | number>) =>
    `              <gx:SimpleArrayData name="${name}">\n` +
    values.map((v) => `                <gx:value>${v}</gx:value>`).join("\n") +
    `\n              </gx:SimpleArrayData>`;

  const animatedFolder = `    <Folder>
      <name>Track (animated)</name>
      <Placemark>
        <name>${xmlEscape(label)}</name>
        <styleUrl>#trackStyle</styleUrl>
        <gx:Track>
          <altitudeMode>clampToGround</altitudeMode>
${rows.map((r) => `          <when>${iso(r.captured_at)}</when>`).join("\n")}
${rows.map((r) => `          <gx:coord>${r.lon} ${r.lat} 0</gx:coord>`).join("\n")}
          <ExtendedData>
            <SchemaData>
${simpleArray("speed_mps", rows.map((r) => r.speed_mps))}
${simpleArray("heading_deg", rows.map((r) => r.heading_deg))}
${simpleArray("gps_accuracy_m", rows.map((r) => r.gps_accuracy_m))}
${simpleArray("battery_pct", rows.map((r) => r.battery_pct))}
            </SchemaData>
          </ExtendedData>
        </gx:Track>
      </Placemark>
    </Folder>

`;

  const stamp = (d: Date) => (simple ? "" : `\n        <TimeStamp><when>${iso(d)}</when></TimeStamp>`);

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"${simple ? "" : ` xmlns:gx="http://www.google.com/kml/ext/2.2"`}>
  <Document>
    <name>${xmlEscape(label)} - telemetry</name>
    <description>${xmlEscape(summary)}</description>

    <Style id="trackStyle">
      <LineStyle><color>ff0288d1</color><width>4</width></LineStyle>
      <IconStyle><scale>0.8</scale></IconStyle>
    </Style>
    <Style id="startStyle"><IconStyle><color>ff00c853</color><scale>1.1</scale></IconStyle></Style>
    <Style id="endStyle"><IconStyle><color>ff0000ff</color><scale>1.1</scale></IconStyle></Style>

${simple ? "" : animatedFolder}    <Folder>
      <name>Path</name>
      <Placemark>
        <name>${xmlEscape(label)} path</name>
        <styleUrl>#trackStyle</styleUrl>
        <LineString>
          <tessellate>1</tessellate>
          <altitudeMode>clampToGround</altitudeMode>
          <coordinates>${rows.map((r) => `${r.lon},${r.lat},0`).join(" ")}</coordinates>
        </LineString>
      </Placemark>
    </Folder>

    <Folder>
      <name>Start and end</name>
      <Placemark>
        <name>Start</name>
        <styleUrl>#startStyle</styleUrl>${stamp(rows[0].captured_at)}
        <Point><coordinates>${rows[0].lon},${rows[0].lat},0</coordinates></Point>
      </Placemark>
      <Placemark>
        <name>End</name>
        <styleUrl>#endStyle</styleUrl>${stamp(rows[rows.length - 1].captured_at)}
        <Point><coordinates>${rows[rows.length - 1].lon},${rows[rows.length - 1].lat},0</coordinates></Point>
      </Placemark>
    </Folder>
  </Document>
</kml>
`;

  writeFileSync(outPath, kml, "utf8");
  console.log(`Wrote ${outPath}\n`);
  console.log(summary);
}

main()
  .catch((err) => {
    console.error("Export failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
