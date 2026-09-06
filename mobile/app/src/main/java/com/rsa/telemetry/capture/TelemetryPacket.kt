package com.rsa.telemetry.capture

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName

/**
 * Wire format for a single telemetry packet, matching the backend's `POST /v1/telemetry`
 * contract field-for-field (see server API docs). The server accepts a JSON array of these.
 */
@Serializable
data class TelemetryPacket(
    @SerialName("packet_id") val packetId: String,
    @SerialName("device_id") val deviceId: String,
    @SerialName("captured_at") val capturedAt: String,
    val lat: Double,
    val lon: Double,
    @SerialName("altitude_m") val altitudeM: Double,
    @SerialName("gps_accuracy_m") val gpsAccuracyM: Double,
    @SerialName("speed_mps") val speedMps: Double,
    @SerialName("heading_deg") val headingDeg: Double,
    val acceleration: Acceleration,
    @SerialName("battery_pct") val batteryPct: Int,
)

@Serializable
data class Acceleration(
    val x: Double,
    val y: Double,
    val z: Double,
)
