import { escapeHtml, page } from "./layout";
import { MAX_FROZEN_OPACITY, SPEED_RAMP, bandColour, bandSpeedBoundsKt } from "./theme";
import type { DeviceStatus, FlightSummary, TrackPoint } from "../db/flightRepository";
import {
  DATA_GAP_MILLIS,
  isInProgress,
  trackDistanceMetres,
} from "../services/flightSegmentation";
import { SPEED_BAND_COUNT, bandTrack } from "../services/trackBanding";
import type { ShapePoint } from "../services/trackShape";
import {
  KNOTS_PER_MPS,
  formatKnots,
  formatNauticalMiles,
  toFeet,
  toKnots,
  toNauticalMiles,
} from "../services/units";
import { frozenBands, profileColumns, profileScale } from "../services/verticalProfile";

/**
 * Every timestamp a human reads in this system is local; every timestamp stored or transmitted is
 * UTC. The same rule the phone follows, for the same reason - one instant, one stored form.
 *
 * A fixed -03:00 rather than the viewer's own zone: a flight flown here happened at a local time,
 * and re-labelling it to wherever the browser happens to be would make two people describing the
 * same flight disagree about when it was.
 */
const TZ = "America/Argentina/Buenos_Aires";

/** The same offset, as minutes, for the client script - which formats without Intl. */
const TZ_OFFSET_MINUTES = -180;

/**
 * 24-hour, always.
 *
 * The es-AR locale defaults to a 12-hour clock, which rendered 19:16 as "07:16 p. m." - ambiguous
 * at a glance, noisy in a list, and simply not how aviation states a time. `hourCycle` is not
 * optional here.
 */
const HOUR_CYCLE = "h23" as const;

/**
 * Finer than one column per pixel at the page's 960px maximum, and capped by profileColumns to the
 * sample count so a short flight simply produces fewer.
 */
const PROFILE_COLUMNS = 720;

/** The SVG's viewBox height, and its CSS height in pixels - so one y unit is one pixel. */
const PROFILE_HEIGHT = 120;

function localDateTime(d: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: HOUR_CYCLE,
  }).format(d);
}

function localTime(d: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: HOUR_CYCLE,
  }).format(d);
}

function durationText(from: Date, to: Date): string {
  const minutes = Math.round((to.getTime() - from.getTime()) / 60000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

export function flightPath(flight: FlightSummary): string {
  return `/flights/${encodeURIComponent(flight.deviceId)}/${flight.startedAt.getTime()}`;
}

/**
 * Duration as h:mm rather than "38 min".
 *
 * The ledger's columns only read as columns when every cell is the same shape, and h:mm is how a
 * logbook states time anyway. The open entry above the ledger is a headline rather than a column,
 * so it keeps the friendlier wording.
 */
function hoursMinutes(from: Date, to: Date): string {
  const minutes = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * The local calendar day, as a sortable key.
 *
 * Shifting by the fixed offset and reading the UTC date is the whole conversion, because Argentina
 * keeps no daylight saving. Grouping on the raw UTC date instead would file every flight after
 * 21:00 local under the following day.
 */
function localDayKey(d: Date): string {
  return new Date(d.getTime() + TZ_OFFSET_MINUTES * 60000).toISOString().slice(0, 10);
}

function localDay(d: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
}

/**
 * The day's totals, the way a logbook foots each page.
 *
 * A count, the hours flown and the distance covered. It is also what makes the day heading
 * answerable: "Hoy" over a list is a label, "Hoy · 2 vuelos · 1:26" is a fact the reader can check
 * against the rows beneath it.
 */
function dayTotal(flights: FlightSummary[]): string {
  const minutes = flights.reduce(
    (total, f) => total + Math.round((f.endedAt.getTime() - f.startedAt.getTime()) / 60000),
    0
  );
  const miles = flights.reduce((total, f) => total + toNauticalMiles(f.distanceM), 0);

  return [
    `${flights.length} ${flights.length === 1 ? "vuelo" : "vuelos"}`,
    `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")} h`,
    `${miles.toFixed(1)} NM`,
  ].join(" · ");
}

/** "Hoy" and "Ayer" carry more than a date does for the two days a reader actually asks about. */
function dayHeading(d: Date, nowMillis: number): string {
  const key = localDayKey(d);
  if (key === localDayKey(new Date(nowMillis))) return "Hoy";
  if (key === localDayKey(new Date(nowMillis - 24 * 60 * 60 * 1000))) return "Ayer";
  return localDay(d);
}

/**
 * How long ago something happened, at the coarsest granularity that is still true.
 *
 * Rendered on the server, so it ages between request and read. The page refreshes itself while a
 * flight is running, and the granularity below a minute is deliberately vague rather than a
 * second count that would be visibly wrong the moment it arrives.
 */
export function relativeAge(fromMillis: number, nowMillis: number): string {
  const seconds = Math.max(0, Math.round((nowMillis - fromMillis) / 1000));
  if (seconds < 45) return "hace instantes";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;

  return `hace ${Math.round(hours / 24)} d`;
}

/**
 * How quiet a registered device has to be before the roster says so out loud.
 *
 * A week, and it is a judgement rather than a measurement: an aircraft that flies at weekends is
 * legitimately silent for days, so anything shorter would cry wolf. What it is really watching for
 * is this project's one risk with no software fix - an OEM battery manager killing the background
 * service - whose only symptom is silence. The roster states the age either way and only changes
 * its emphasis here.
 */
const SILENT_AFTER_MILLIS = 7 * 24 * 60 * 60 * 1000;

type DeviceState = "live" | "quiet" | "silent";

function deviceState(device: DeviceStatus, nowMillis: number): DeviceState {
  if (!device.lastSeenAt) return "silent";
  if (isInProgress(device.lastSeenAt.getTime(), nowMillis)) return "live";
  return nowMillis - device.lastSeenAt.getTime() > SILENT_AFTER_MILLIS ? "silent" : "quiet";
}

function deviceSignal(device: DeviceStatus, nowMillis: number): string {
  if (!device.lastSeenAt) return "nunca reportó";

  const age = relativeAge(device.lastSeenAt.getTime(), nowMillis);
  const state = deviceState(device, nowMillis);
  if (state === "live") return `reportando, ${age}`;
  return state === "silent" ? `sin señal ${age}` : age;
}

/**
 * The track as a glyph: a polyline in a unit box, with a mark at the first fix.
 *
 * The viewBox is padded past the box so a stroke on the edge is not sliced in half, and the
 * polyline's stroke is non-scaling so one flight's outline is not drawn heavier than another's
 * because it happened to be more compact.
 */
function trackGlyph(shape: ShapePoint[], extraClass = ""): string {
  const className = `glyph${extraClass ? ` ${extraClass}` : ""}`;
  if (shape.length < 2) return `<span class="${className} glyph--none"></span>`;

  const points = shape.map((p) => `${p.x},${p.y}`).join(" ");
  return `<svg class="${className}" viewBox="-0.08 -0.08 1.16 1.16"
       preserveAspectRatio="xMidYMid meet" focusable="false">
    <polyline class="glyph-line" points="${escapeHtml(points)}" vector-effect="non-scaling-stroke"/>
    <circle class="glyph-start" cx="${escapeHtml(shape[0].x)}" cy="${escapeHtml(
      shape[0].y
    )}" r="0.075"/>
  </svg>`;
}

/**
 * One spoken sentence per row rather than seven loose fragments.
 *
 * Every cell inside the link is hidden from assistive technology and this label replaces the lot:
 * a screen reader announcing "11:00, 0:38, 6,9, 74, 2.400" has been handed the columns without the
 * headings that made them mean anything.
 */
function flightLabel(f: FlightSummary): string {
  return [
    f.deviceLabel,
    `${localDateTime(f.startedAt)} GMT-3`,
    `duración ${durationText(f.startedAt, f.endedAt)}`,
    `distancia ${formatNauticalMiles(f.distanceM)}`,
    `GS máxima ${formatKnots(f.maxSpeedMps)}`,
    `${f.packetCount.toLocaleString("es-AR")} puntos`,
  ].join(", ");
}

/**
 * One ledger line.
 *
 * The numeric cells are nested in their own grid so the same template can serve two layouts: one
 * line of aligned columns on a wide screen, two lines on a narrow one. The `u` spans carry each
 * figure's unit and appear only on the narrow layout, where the column header that would otherwise
 * have named them is not on screen - four bare numerals with nothing to say what they are is the
 * failure this redesign exists to fix, and it would be a shame to reintroduce it on the phone.
 */
function ledgerRow(f: FlightSummary): string {
  return `<li class="row">
      <a class="entry" href="${escapeHtml(flightPath(f))}"
         aria-label="${escapeHtml(flightLabel(f))}">
        <time class="cell cell--time" aria-hidden="true"
              datetime="${escapeHtml(f.startedAt.toISOString())}">${escapeHtml(
                localTime(f.startedAt)
              )}</time>
        <span class="cell cell--glyph" aria-hidden="true">${trackGlyph(f.shape)}</span>
        <span class="cell cell--craft" aria-hidden="true">${escapeHtml(f.deviceLabel)}</span>
        <span class="cell-nums" aria-hidden="true">
          <span class="cell cell--num">${escapeHtml(
            hoursMinutes(f.startedAt, f.endedAt)
          )}<span class="u">h</span></span>
          <span class="cell cell--num">${escapeHtml(
            toNauticalMiles(f.distanceM).toFixed(1)
          )}<span class="u">NM</span></span>
          <span class="cell cell--num">${escapeHtml(
            Math.round(toKnots(f.maxSpeedMps))
          )}<span class="u">kt máx</span></span>
          <span class="cell cell--num cell--faint">${escapeHtml(
            f.packetCount.toLocaleString("es-AR")
          )}<span class="u">pt</span></span>
        </span>
      </a>
    </li>`;
}

/**
 * How the newest flight stands right now.
 *
 * Three states rather than two, because two would overclaim. `pending` is the honest middle: the
 * last packet is minutes old, which is longer than a missed upload cycle but shorter than the gap
 * that ends a flight - so nothing has closed this flight, and the aircraft may simply be inside a
 * coverage hole with its packets queued on the phone. Calling that "Último vuelo" would tell the
 * operator the flight is over on exactly the question they asked for by name.
 */
type LeadState = "live" | "pending" | "closed";

export function leadState(lastPacketAtMillis: number, nowMillis: number): LeadState {
  if (isInProgress(lastPacketAtMillis, nowMillis)) return "live";
  return nowMillis - lastPacketAtMillis < DATA_GAP_MILLIS ? "pending" : "closed";
}

/**
 * The newest flight, as the ledger's own top line rather than a metric slab.
 *
 * The figures carry no labels of their own: they sit on the shared `--nums` template directly
 * above the column header that names them, at close to the ledger's own scale. Giving them large
 * numerals and their own small captions turned this into the big-number panel the direction
 * explicitly refuses, with every caption repeated thirty pixels below.
 */
function openEntry(f: FlightSummary, state: LeadState, nowMillis: number): string {
  const age = escapeHtml(relativeAge(f.endedAt.getTime(), nowMillis));
  const status =
    state === "live"
      ? `<span class="open-live"><span class="open-pulse"></span>En curso</span>
         <span class="open-age">último paquete ${age}</span>`
      : state === "pending"
        ? `<span class="open-pending">Sin señal</span>
           <span class="open-age">último paquete ${age} · nada lo cerró todavía</span>`
        : `<span class="open-last">Último vuelo</span><span class="open-age">${age}</span>`;
  const live = state === "live";

  // The same four figures as the ledger, in the same order, on the same column template - so the
  // open line's numbers sit directly above the columns they belong to. That shared grammar is the
  // whole reason this is an entry rather than a hero panel bolted on top of a table.
  const spoken =
    state === "live" ? "Vuelo en curso" : state === "pending" ? "Vuelo sin señal" : "Último vuelo";

  // The date, always. An earlier version stated clock times only, which reads fine for a flight
  // that landed an hour ago and says nothing at all about one from last Tuesday.
  const when = `${localDay(f.startedAt)}, ${localTime(f.startedAt)}${
    live ? "" : ` a ${localTime(f.endedAt)}`
  }`;

  // A pending flight is open too - nothing closed it - so it is drawn without a closing rule as
  // well, in the colour its own label uses rather than the live green it is not earning.
  return `<section class="open open--${escapeHtml(state)}">
      <a class="open-entry" href="${escapeHtml(flightPath(f))}"
         aria-label="${escapeHtml(`${spoken}. ${flightLabel(f)}`)}">
        <div class="open-status" aria-hidden="true">${status}</div>
        <span class="open-glyph" aria-hidden="true">${trackGlyph(f.shape, "glyph--lg")}</span>
        <div class="open-body" aria-hidden="true">
          <span class="open-craft">${escapeHtml(f.deviceLabel)}</span>
          <span class="open-when">${escapeHtml(when)}</span>
        </div>
        <span class="cell-nums open-figures" aria-hidden="true">
          <span class="cell cell--num">${escapeHtml(
            hoursMinutes(f.startedAt, f.endedAt)
          )}<span class="u">h</span></span>
          <span class="cell cell--num">${escapeHtml(
            toNauticalMiles(f.distanceM).toFixed(1)
          )}<span class="u">NM</span></span>
          <span class="cell cell--num">${escapeHtml(
            Math.round(toKnots(f.maxSpeedMps))
          )}<span class="u">kt máx</span></span>
          <span class="cell cell--num cell--faint">${escapeHtml(
            f.packetCount.toLocaleString("es-AR")
          )}<span class="u">pt</span></span>
        </span>
      </a>
    </section>`;
}

/** Silent first, then reporting, then merely parked: the order the operator needs them in. */
const STATE_ORDER: Record<DeviceState, number> = { silent: 0, live: 1, quiet: 2 };

/**
 * The fleet, as one line that opens.
 *
 * An earlier version listed every device above everything else, and with eight of them it filled
 * the first screen of a page whose job is to open a flight. A warning that is always on, always
 * the same size, is furniture rather than a warning - so the count and the problem stay on the
 * summary line, the per-device detail collapses behind it, and the whole thing springs open by
 * itself when a device has actually gone quiet. `details` does this natively: no script, keyboard
 * reachable, and it survives a page with no JavaScript at all.
 */
function roster(devices: DeviceStatus[], nowMillis: number): string {
  if (devices.length === 0) return "";

  const withState = devices
    .map((device) => ({ device, state: deviceState(device, nowMillis) }))
    .sort(
      (a, b) =>
        STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
        a.device.deviceLabel.localeCompare(b.device.deviceLabel, "es")
    );

  const silent = withState.filter((d) => d.state === "silent");
  const live = withState.filter((d) => d.state === "live");

  const tally = [
    live.length > 0
      ? `<span class="fleet-count fleet-count--live">${live.length} reportando</span>`
      : "",
    silent.length > 0
      ? `<span class="fleet-count fleet-count--silent">${silent.length} sin señal</span>`
      : "",
    `<span class="fleet-count">${devices.length} ${
      devices.length === 1 ? "aeronave" : "aeronaves"
    }</span>`,
  ]
    .filter(Boolean)
    .join('<span class="fleet-sep">·</span>');

  const items = withState
    .map(
      ({ device, state }) => `<li class="fleet-item fleet-item--${state}">
          <span class="fleet-light"></span>
          <span class="fleet-name">${escapeHtml(device.deviceLabel)}</span>
          <span class="fleet-signal">${escapeHtml(deviceSignal(device, nowMillis))}</span>
        </li>`
    )
    .join("");

  // Open by itself when something is quiet, so the one case worth interrupting for cannot be
  // missed, and closed on a healthy fleet, where it is only a reassurance.
  return `<section class="fleet">
      <details class="fleet-details"${silent.length > 0 ? " open" : ""}>
        <summary class="fleet-summary">
          <span class="fleet-title">Flota</span>
          <span class="fleet-tally">${tally}</span>
        </summary>
        <ul class="fleet-list">${items}</ul>
      </details>
    </section>`;
}

export interface FlightIndex {
  /** Newest first, as [listFlights] returns them. */
  flights: FlightSummary[];
  devices: DeviceStatus[];
  nowMillis: number;
}

export function flightListPage(index: FlightIndex): string {
  const { flights, devices, nowMillis } = index;
  const fleet = roster(devices, nowMillis);

  if (flights.length === 0) {
    return page(
      "Vuelos",
      `${fleet}
       <p class="empty">Todavía no hay vuelos registrados. Aparecen solos acá cuando un dispositivo
       empieza a capturar y se mueve.</p>`
    );
  }

  const lead = flights[0];
  const state = leadState(lead.endedAt.getTime(), nowMillis);

  // Every flight is grouped, the newest included. An earlier version pulled the lead out of `rest`
  // and grouped the remainder, which quietly removed the newest flight from its own day: a page
  // where two flights happened today showed "Hoy" with one row under it. The open entry is a
  // shortcut to the top of the book, not a hole in it.
  const groups: Array<{ key: string; heading: string; flights: FlightSummary[] }> = [];
  for (const f of flights) {
    const key = localDayKey(f.startedAt);
    const current = groups[groups.length - 1];
    if (current && current.key === key) current.flights.push(f);
    else groups.push({ key, heading: dayHeading(f.startedAt, nowMillis), flights: [f] });
  }

  const ledger = groups
    .map(
      (g) => `<section class="day">
        <h2 class="day-heading">
          <span class="day-name">${escapeHtml(g.heading)}</span>
          <span class="day-total">${escapeHtml(dayTotal(g.flights))}</span>
        </h2>
        <ol class="rows">${g.flights.map(ledgerRow).join("")}</ol>
      </section>`
    )
    .join("");

  // The column meanings live once, in the header, so the rows and the open entry above can carry
  // bare numerals. Sticky, because a thirty-entry ledger scrolls its only key off screen
  // otherwise. Hidden from assistive technology: every row states its figures in words instead.
  const columns = `<div class="rows-head" aria-hidden="true">
      <span>Hora</span><span></span><span>Aeronave</span>
      <span class="cell-nums">
        <span class="cell--num">Dur.</span><span class="cell--num">NM</span>
        <span class="cell--num">GS máx</span><span class="cell--num">Puntos</span>
      </span>
    </div>`;

  // Only while something is flying, and only while the tab is actually being looked at. This is
  // the page reloading itself rather than a live channel - the design has no polling service and
  // wants none - and a hidden tab reloading on a free-tier server would be spending someone's
  // dyno on nobody.
  // `pending` refreshes too, and it is the state that needs it most: it is the page saying nothing
  // has closed this flight yet, so it is the page waiting for the queue to drain. Gating this on
  // `live` alone left the one uncertain state frozen, unable to resolve its own question.
  const refresh =
    state === "live" || state === "pending"
      ? `<p class="auto">Se actualiza sola cada 30 s mientras haya un vuelo sin cerrar.</p>
         <script>
           setTimeout(function () {
             if (document.visibilityState === 'visible') location.reload();
             else document.addEventListener('visibilitychange', function () { location.reload(); });
           }, 30000);
         </script>`
      : "";

  // The roster opens itself when a device is silent, which the reload above would otherwise
  // re-impose every thirty seconds on an operator who had closed it. Session storage, so it is
  // this tab's view state and nothing follows the reader to another day.
  const rosterMemory = `<script>
      (function () {
        var box = document.querySelector('.fleet-details');
        if (!box) return;
        try {
          var saved = sessionStorage.getItem('rsa.fleet');
          if (saved !== null) box.open = saved === '1';
          box.addEventListener('toggle', function () {
            sessionStorage.setItem('rsa.fleet', box.open ? '1' : '0');
          });
        } catch (e) {
          // Private mode or blocked storage. The server-rendered default stands.
        }
      })();
    </script>`;

  return page(
    "Vuelos",
    `${fleet}${openEntry(lead, state, nowMillis)}${columns}${ledger}${refresh}${rosterMemory}`
  );
}

/**
 * The single payload the client script reads: the track, and the bands to draw it in.
 *
 * Rounded and positional rather than named. The full track of a 1 Hz flight is tens of thousands of
 * numbers, and six decimals of latitude is already about ten centimetres - more precision than the
 * GPS has and more bytes than the page can afford. Times are seconds from the flight's first point
 * for the same reason: an ISO string per point is roughly as large as the coordinates it labels.
 *
 * Elevation is here now, in whole feet, appended rather than inserted: every consumer indexes this
 * tuple positionally, so a new slot in the middle would break them without a word. The page states
 * plainly what the value is worth, and the profile draws the evidence alongside it.
 */
function flightPayload(points: TrackPoint[]): string {
  const startedAt = points.length > 0 ? points[0].capturedAt.getTime() : 0;

  const payload = {
    startedAt,
    points: points.map((p) => [
      Number(p.lat.toFixed(6)),
      Number(p.lon.toFixed(6)),
      Number(p.speedMps.toFixed(1)),
      Math.round((p.capturedAt.getTime() - startedAt) / 1000),
      Math.round(p.headingDeg),
      Math.round(toFeet(p.altitudeM)),
    ]),
    bands: bandTrack(
      points.map((p) => p.speedMps),
      SPEED_BAND_COUNT
    ).map((b) => ({
      band: b.band,
      // The same array the legend renders, so the key under the map cannot drift from the line.
      color: bandColour(b.band),
      ranges: b.ranges,
    })),
  };

  // The payload is numbers only, so it cannot currently contain a closing tag - escaped anyway so
  // that adding a string field later cannot quietly end the script element.
  return JSON.stringify(payload).replace(/</g, "\\u003c");
}

export function flightDetailPage(flight: FlightSummary, points: TrackPoint[]): string {
  const distanceM = trackDistanceMetres(points);
  const accuracies = points.map((p) => p.gpsAccuracyM);
  const medianAccuracy = accuracies.length
    ? [...accuracies].sort((a, b) => a - b)[Math.floor(accuracies.length / 2)]
    : 0;
  // A loop, not `Math.max(...elevations)`: a long flight at 1 Hz is tens of thousands of points, and
  // spreading that into a call is an argument list the engine is entitled to refuse.
  let maxElevM = 0;
  let minElevM = 0;
  points.forEach((p, i) => {
    if (i === 0 || p.altitudeM > maxElevM) maxElevM = p.altitudeM;
    if (i === 0 || p.altitudeM < minElevM) minElevM = p.altitudeM;
  });

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

  // A slider as well as the pointer: hovering a line is unusable on a phone and unreachable from a
  // keyboard, and scrubbing a track second by second is how a flight actually gets reviewed.
  const scrub =
    points.length > 1
      ? `<input class="scrub" id="scrub" type="range" min="0" max="${points.length - 1}"
                value="0" step="1" aria-label="Punto del vuelo">`
      : "";

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

  const inspector = `
    <div class="inspector">
      ${legend}
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
      ${scrub}
    </div>`;

  const columns = profileColumns(points, PROFILE_COLUMNS);
  const scale = profileScale(columns);
  const spanFt = scale.maxFt - scale.minFt;
  const yOf = (ft: number): number => ((scale.maxFt - ft) / spanFt) * PROFILE_HEIGHT;

  // Full-height bands behind the trace, tinted by how much of the run repeated. Drawn first so the
  // trace stays on top of its own caveat rather than under it.
  const shading = frozenBands(columns, MAX_FROZEN_OPACITY)
    .map(
      (b) =>
        `<rect class="profile-frozen" fill-opacity="${escapeHtml(
          b.opacity.toFixed(3)
        )}" x="${escapeHtml(b.x)}" y="0" width="${escapeHtml(b.width)}" height="${escapeHtml(
          PROFILE_HEIGHT
        )}"/>`
    )
    .join("");

  // One rect per column, and columns a coverage gap left empty are simply skipped: a line drawn
  // across a gap is a measurement nobody took. A floor of 1.5 units keeps a flat column visible
  // instead of collapsing it to nothing.
  const envelope = columns
    .filter((c) => c.sampleCount > 0)
    .map((c) => {
      const height = Math.max(yOf(c.minFt) - yOf(c.maxFt), 1.5);
      // The floor has to grow upward once a column reaches the bottom of the frame. A flat column
      // at the flight's lowest recorded value lands on y = PROFILE_HEIGHT exactly, and giving it
      // height from there puts it past the viewBox, where the SVG clips it away entirely - and the
      // columns sitting at that lowest value are the stationary ground stretches this whole chart
      // exists to make visible.
      const top = Math.min(yOf(c.maxFt), PROFILE_HEIGHT - height);
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
          ${shading}
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

  const head = `
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>`;

  const body = `
    <h2>${escapeHtml(flight.deviceLabel)}</h2>
    <p class="flight-when">
      ${escapeHtml(localDateTime(flight.startedAt))} a ${escapeHtml(localTime(flight.endedAt))} GMT-3
    </p>
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
      sombreada. Quieto en tierra esa marca dice algo, porque un modelo de terreno consultado desde el
      mismo punto devuelve siempre lo mismo, y ahí cubre casi todo el recorrido.
      En vuelo no dice nada: a 40 m/s el avión recorre 40 m entre fixes, así que un modelo de terreno
      también cambia de valor y las marcas desaparecen igual. Lo que decide en el aire es la forma del
      perfil: si mientras el avión trepa la traza se queda en la elevación del campo, es terreno; si
      acompaña la trepada, es una medición.
    </div>
    <script>
      var flight = ${flightPayload(points)};
      var points = flight.points;
      var latlngs = points.map(function (p) { return [p[0], p[1]]; });

      // Canvas, not SVG: at 1 Hz a long flight is tens of thousands of vertices, and the SVG
      // renderer puts every one of them in the DOM.
      var map = L.map('map', { preferCanvas: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; colaboradores de OpenStreetMap'
      }).addTo(map);

      // One layer per speed band, each holding every run of track that falls in it. The map used
      // to add one layer per pair of points, which does not survive a flight of this length.
      flight.bands.forEach(function (band) {
        L.polyline(
          band.ranges.map(function (r) { return latlngs.slice(r[0], r[1] + 1); }),
          { color: band.color, weight: 4, opacity: 0.9 }
        ).addTo(map);
      });

      if (latlngs.length > 0) {
        L.circleMarker(latlngs[0], { radius: 7, color: '#00c853', fillOpacity: 1 })
          .addTo(map).bindPopup('Inicio');
        L.circleMarker(latlngs[latlngs.length - 1], { radius: 7, color: '#d50000', fillOpacity: 1 })
          .addTo(map).bindPopup('Fin');
      }

      /*
       * Leaflet measures its container once and caches the result. A map built while that container
       * has no laid-out width - a background tab, a pane the host sizes after load, an iframe that
       * gets its dimensions late - caches zero, and every zoom it computes from then on comes out
       * at the maximum: the page shows an empty grey square over the middle of nowhere and never
       * recovers on its own. So fit only from a size that was really measured, and if there was
       * none yet, wait for one.
       */
      var fitted = false;

      // A provisional view straight away. Without one the map is not merely badly framed, it has no
      // view at all, and every Leaflet call that needs a centre throws - so refusing to fit from a
      // bogus size must not be the only thing that happens here.
      map.setView(latlngs.length > 0 ? latlngs[0] : [-38.93, -67.97], 11);

      function fitTrack() {
        map.invalidateSize();
        var size = map.getSize();
        if (size.x === 0 || size.y === 0) return;

        if (latlngs.length > 0) map.fitBounds(L.latLngBounds(latlngs), { padding: [24, 24] });
        else map.setView([-38.93, -67.97], 11);
        fitted = true;
      }

      fitTrack();

      if (!fitted && typeof ResizeObserver === 'function') {
        // Disconnected as soon as one fit lands, so a later resize - or the reader's own panning -
        // is never overridden.
        var observer = new ResizeObserver(function () {
          fitTrack();
          if (fitted) observer.disconnect();
        });
        observer.observe(document.getElementById('map'));
      } else if (!fitted) {
        window.addEventListener('load', fitTrack);
      }

      window.addEventListener('resize', function () { map.invalidateSize(); });

      var readout = document.getElementById('readout');
      var hint = document.getElementById('readout-hint');
      var scrub = document.getElementById('scrub');
      var timeCell = document.getElementById('r-time');
      var speedCell = document.getElementById('r-speed');
      var headingCell = document.getElementById('r-heading');
      var elevCell = document.getElementById('r-elev');
      var profileCursor = document.getElementById('profile-cursor');
      // Not "profileColumns": that is the name of the server-side function that produced this
      // number, and the two live in different scopes only by accident of where they are written.
      var profileColumnCount = ${columns.length};
      var profileSeconds = points.length > 1 ? points[points.length - 1][3] : 0;
      var cursor = L.circleMarker([0, 0], {
        radius: 6, color: '#ffffff', weight: 2, fillColor: '#0288d1', fillOpacity: 1
      });

      function pad(n) { return n < 10 ? '0' + n : '' + n; }

      // The server stores UTC and states GMT-3, and Argentina keeps no daylight saving, so a fixed
      // shift is the entire conversion - no Intl, no time zone database on a cheap phone.
      function localClock(millis) {
        var d = new Date(millis + ${TZ_OFFSET_MINUTES} * 60000);
        return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
      }

      function show(i) {
        var p = points[i];
        if (!p) return;
        timeCell.textContent = localClock(flight.startedAt + p[3] * 1000);
        speedCell.textContent = (p[2] * ${KNOTS_PER_MPS}).toFixed(0) + ' kt';
        headingCell.textContent = p[4] + '\\u00b0';
        elevCell.textContent = p[5] + ' ft';
        readout.hidden = false;
        hint.hidden = true;
        cursor.setLatLng([p[0], p[1]]).addTo(map);
        if (profileCursor && profileSeconds > 0) {
          // The cursor is placed in viewBox units, which are columns - so the same number of
          // seconds always lands on the same column whatever width the card ends up.
          var profileX = (p[3] / profileSeconds) * profileColumnCount;
          profileCursor.setAttribute('x1', profileX);
          profileCursor.setAttribute('x2', profileX);
          // removeAttribute, not .hidden: \`hidden\` is an HTMLElement property and an SVG element
          // would take the assignment as an expando and never show the line.
          profileCursor.removeAttribute('hidden');
        }
        if (scrub && scrub.value !== String(i)) scrub.value = i;
      }

      // Longitude degrees are shorter than latitude degrees away from the equator, so comparing
      // raw degrees would bias every match along one axis. One cosine for the whole track is
      // plenty over the distance a flight from here covers.
      var cosLat = latlngs.length ? Math.cos(latlngs[0][0] * Math.PI / 180) : 1;

      function nearestIndex(latlng) {
        var best = -1;
        var bestDistance = Infinity;
        for (var i = 0; i < points.length; i++) {
          var dy = points[i][0] - latlng.lat;
          var dx = (points[i][1] - latlng.lng) * cosLat;
          var distance = dy * dy + dx * dx;
          if (distance < bestDistance) { bestDistance = distance; best = i; }
        }
        // Scaled to the current view, so the pointer has to be near the line at any zoom rather
        // than within some fixed number of degrees.
        var bounds = map.getBounds();
        var tolerance = (bounds.getNorth() - bounds.getSouth()) * 0.04;
        return bestDistance <= tolerance * tolerance ? best : -1;
      }

      function inspectAt(e) {
        var i = nearestIndex(e.latlng);
        if (i >= 0) show(i);
      }

      map.on('mousemove', inspectAt);
      map.on('click', inspectAt);
      if (scrub) {
        scrub.addEventListener('input', function () { show(Number(scrub.value)); });
      }
    </script>`;

  return page(`${flight.deviceLabel} · vuelo`, body, head, "/");
}
