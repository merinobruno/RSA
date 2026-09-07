package com.rsa.telemetry.util

import com.rsa.telemetry.capture.TelemetryPacket
import java.util.Locale

/**
 * Renders a packet as the aligned, labelled block shown on the main screen, so the operator can
 * see exactly what is being sent without reading raw JSON.
 *
 * Pure Kotlin, no Android imports, so the formatting is unit tested directly.
 *
 * Two deliberate choices about what the human sees versus what travels:
 *
 * - The time is shown in local time ([Iso8601.LOCAL_ZONE_LABEL]) because a pilot reads a clock,
 *   not a UTC stamp. The packet still carries UTC and nothing converts it; this is a lens, not a
 *   second timestamp. One instant, one stored representation.
 * - Speed is shown in km/h alone. The wire carries m/s, which is the right unit for computation
 *   and the wrong one for a person glancing at a phone before takeoff.
 *
 * Every number goes through [Locale.US] deliberately. The default locale here is es-AR, where
 * `"%.6f".format(-38.9315414)` yields `-38,931541` - a comma decimal separator. Coordinates with
 * commas are hard to read beside a comma-separated lat/lon pair, cannot be pasted into a mapping
 * tool, and would not match the dot the packet actually puts on the wire.
 */
object PacketFormatter {

    private const val MPS_TO_KMH = 3.6

    /** Kept short so the widest row still fits a narrow phone at a large, readable font size. */
    private const val LABEL_WIDTH = 8

    fun format(packet: TelemetryPacket): String {
        fun row(label: String, value: String) = "%-${LABEL_WIDTH}s %s".format(Locale.US, label, value)

        return listOf(
            row("time", "${Iso8601.toLocalDisplay(packet.capturedAt)} ${Iso8601.LOCAL_ZONE_LABEL}"),
            row("speed", "%.0f km/h".format(Locale.US, packet.speedMps * MPS_TO_KMH)),
            row("heading", "%.0f°".format(Locale.US, packet.headingDeg)),
            row("altitude", "%.0f m".format(Locale.US, packet.altitudeM)),
            row("battery", "${packet.batteryPct}%"),
            row("lat", "%.6f".format(Locale.US, packet.lat)),
            row("lon", "%.6f".format(Locale.US, packet.lon)),
            row("accuracy", "%.0f m".format(Locale.US, packet.gpsAccuracyM)),
            row(
                "accel",
                "%+.2f %+.2f %+.2f".format(
                    Locale.US,
                    packet.acceleration.x,
                    packet.acceleration.y,
                    packet.acceleration.z
                )
            ),
        ).joinToString("\n")
    }
}
