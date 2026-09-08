import { escapeHtml, page } from "./layout";
import { SPEED_RAMP, bandColour, bandSpeedBoundsKt } from "./theme";
import type { FlightSummary, TrackPoint } from "../db/flightRepository";
import { trackDistanceMetres } from "../services/flightSegmentation";
import { SPEED_BAND_COUNT, bandTrack } from "../services/trackBanding";
import { KNOTS_PER_MPS, formatKnots, formatNauticalMiles, toFeet } from "../services/units";
import { profileColumns, profileScale } from "../services/verticalProfile";

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

export function flightListPage(flights: FlightSummary[]): string {
  if (flights.length === 0) {
    return page(
      "Vuelos",
      `<p class="empty">Todavía no hay vuelos registrados. Aparecen solos acá cuando un dispositivo
       empieza a capturar.</p>`
    );
  }

  const items = flights
    .map(
      (f) => `
      <a class="flight" href="${escapeHtml(flightPath(f))}">
        <div class="flight-label">${escapeHtml(f.deviceLabel)}</div>
        <div class="flight-when">
          ${escapeHtml(localDateTime(f.startedAt))} a ${escapeHtml(localTime(f.endedAt))} GMT-3
          · ${escapeHtml(durationText(f.startedAt, f.endedAt))}
          · ${escapeHtml(f.packetCount.toLocaleString("es-AR"))} puntos
          · máx ${escapeHtml(formatKnots(f.maxSpeedMps))}
        </div>
      </a>`
    )
    .join("");

  return page("Vuelos", `<h2>Vuelos</h2>${items}`);
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
      sombreada. En tierra eso cubre casi todo el recorrido. Si en un vuelo real esas marcas
      desaparecen, el número es una medición y no un modelo de terreno.
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
