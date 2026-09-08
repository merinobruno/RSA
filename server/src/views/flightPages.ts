import { escapeHtml, page } from "./layout";
import type { FlightSummary, TrackPoint } from "../db/flightRepository";
import { trackDistanceMetres } from "../services/flightSegmentation";

/**
 * Every timestamp a human reads in this system is local; every timestamp stored or transmitted is
 * UTC. The same rule the phone follows, for the same reason - one instant, one stored form.
 *
 * A fixed -03:00 rather than the viewer's own zone: a flight flown here happened at a local time,
 * and re-labelling it to wherever the browser happens to be would make two people describing the
 * same flight disagree about when it was.
 */
const TZ = "America/Argentina/Buenos_Aires";

/**
 * 24-hour, always.
 *
 * The es-AR locale defaults to a 12-hour clock, which rendered 19:16 as "07:16 p. m." - ambiguous
 * at a glance, noisy in a list, and simply not how aviation states a time. `hourCycle` is not
 * optional here.
 */
const HOUR_CYCLE = "h23" as const;

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
          · máx ${escapeHtml((f.maxSpeedMps * 3.6).toFixed(0))} km/h
        </div>
      </a>`
    )
    .join("");

  return page("Vuelos", `<h2>Vuelos</h2>${items}`);
}

export function flightDetailPage(flight: FlightSummary, points: TrackPoint[]): string {
  const distanceKm = trackDistanceMetres(points) / 1000;
  const maxSpeedKmh = flight.maxSpeedMps * 3.6;
  const accuracies = points.map((p) => p.gpsAccuracyM);
  const medianAccuracy = accuracies.length
    ? [...accuracies].sort((a, b) => a - b)[Math.floor(accuracies.length / 2)]
    : 0;

  const stats = `
    <div class="stats">
      <div>
        <div class="stat-value">${escapeHtml(distanceKm.toFixed(1))} km</div>
        <div class="stat-label">Distancia</div>
      </div>
      <div>
        <div class="stat-value">${escapeHtml(durationText(flight.startedAt, flight.endedAt))}</div>
        <div class="stat-label">Duración</div>
      </div>
      <div>
        <div class="stat-value">${escapeHtml(maxSpeedKmh.toFixed(0))} km/h</div>
        <div class="stat-label">Velocidad máxima</div>
      </div>
      <div>
        <div class="stat-value">${escapeHtml(points.length.toLocaleString("es-AR"))}</div>
        <div class="stat-label">Puntos</div>
      </div>
      <div>
        <div class="stat-value">±${escapeHtml(medianAccuracy.toFixed(0))} m</div>
        <div class="stat-label">Precisión GPS</div>
      </div>
    </div>`;

  // Only the fields the map needs, and rounded: the full track at 1 Hz is a lot of JSON, and six
  // decimals of latitude is already about 10 cm.
  const trackJson = JSON.stringify(
    points.map((p) => [Number(p.lat.toFixed(6)), Number(p.lon.toFixed(6)), Number(p.speedMps.toFixed(1))])
  );

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
    <div class="warning">
      <strong>La altitud de este vuelo no es confiable.</strong>
      El valor que registra el sistema viene en escalones de 10 cm, resultó idéntico bit a bit entre
      dos teléfonos distintos en el mismo lugar, y no cambió en el 63% de los fixes consecutivos
      estando quieto — con el GPS declarando ±15 m de error. Sigue el terreno, que en tierra es
      indistinguible de la altura real y deja de serlo apenas el avión despega. Por eso no se
      grafica.
    </div>
    <script>
      var track = ${trackJson};
      var map = L.map('map');
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; colaboradores de OpenStreetMap'
      }).addTo(map);

      if (track.length > 0) {
        var latlngs = track.map(function (p) { return [p[0], p[1]]; });

        // Coloured by speed: one polyline per segment, so a fast leg reads differently from a slow
        // one without needing a legend to explain the picture.
        var speeds = track.map(function (p) { return p[2]; });
        var maxSpeed = Math.max.apply(null, speeds) || 1;
        for (var i = 1; i < latlngs.length; i++) {
          var ratio = Math.min(speeds[i] / maxSpeed, 1);
          var hue = 210 - ratio * 210; // azul quieto -> rojo rápido
          L.polyline([latlngs[i - 1], latlngs[i]], {
            color: 'hsl(' + hue + ', 85%, 45%)',
            weight: 4,
            opacity: 0.9
          }).addTo(map);
        }

        L.circleMarker(latlngs[0], { radius: 7, color: '#00c853', fillOpacity: 1 })
          .addTo(map).bindPopup('Inicio');
        L.circleMarker(latlngs[latlngs.length - 1], { radius: 7, color: '#d50000', fillOpacity: 1 })
          .addTo(map).bindPopup('Fin');

        map.fitBounds(L.latLngBounds(latlngs), { padding: [24, 24] });
      } else {
        map.setView([-38.93, -67.97], 11);
      }
    </script>`;

  return page(`${flight.deviceLabel} · vuelo`, body, head);
}
