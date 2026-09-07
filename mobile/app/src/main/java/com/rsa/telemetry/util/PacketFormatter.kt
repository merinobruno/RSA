package com.rsa.telemetry.util

import com.rsa.telemetry.capture.TelemetryPacket
import java.util.Locale

/**
 * Renders a packet as the aligned, labelled block shown on the main screen, so the operator can
 * see exactly what is being sent without reading raw JSON.
 *
 * Pure Kotlin, no Android imports, so the formatting is unit tested directly.
 *
 * Every number goes through [Locale.US] deliberately. The default locale here is es-AR, where
 * `"%.6f".format(-38.9315414)` yields `-38,931541` - a comma decimal separator. Coordinates with
 * commas are both hard to read beside a comma-separated lat/lon pair and impossible to paste into
 * a mapping tool, and the value on the wire uses a dot regardless. The display must match what is
 * actually sent, not what the phone's locale prefers.
 */
object PacketFormatter {

    private const val MPS_TO_KMH = 3.6

    fun format(packet: TelemetryPacket): String {
        fun row(label: String, value: String) = "%-9s %s".format(Locale.US, label, value)

        return listOf(
            row("time", packet.capturedAt),
            row("position", "%.6f, %.6f".format(Locale.US, packet.lat, packet.lon)),
            row("accuracy", "%.1f m".format(Locale.US, packet.gpsAccuracyM)),
            row("altitude", "%.1f m".format(Locale.US, packet.altitudeM)),
            row(
                "speed",
                "%.1f m/s  (%.0f km/h)".format(Locale.US, packet.speedMps, packet.speedMps * MPS_TO_KMH)
            ),
            row("heading", "%.0f°".format(Locale.US, packet.headingDeg)),
            row(
                "accel",
                "x %+.2f  y %+.2f  z %+.2f m/s²".format(
                    Locale.US,
                    packet.acceleration.x,
                    packet.acceleration.y,
                    packet.acceleration.z
                )
            ),
            row("battery", "${packet.batteryPct}%"),
            row("packet", packet.packetId),
        ).joinToString("\n")
    }
}
