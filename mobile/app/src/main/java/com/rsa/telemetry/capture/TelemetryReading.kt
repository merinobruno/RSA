package com.rsa.telemetry.capture

/**
 * A single raw sensor snapshot, captured once every 30-second tick, before it is turned into a
 * wire-format [com.rsa.telemetry.capture.TelemetryPacket]. Plain data class with no Android
 * dependency so [PacketFactory] can be exercised in JVM unit tests without an emulator.
 *
 * @property capturedAtEpochMillis wall-clock time the *sensor reading* was taken (not the time
 *   it is later sent), per the server contract for `captured_at`.
 */
data class TelemetryReading(
    val capturedAtEpochMillis: Long,
    val lat: Double,
    val lon: Double,
    val altitudeM: Double,
    val gpsAccuracyM: Float,
    val speedMps: Float,
    val headingDeg: Float,
    val accelX: Float,
    val accelY: Float,
    val accelZ: Float,
    val batteryPct: Int,
)
