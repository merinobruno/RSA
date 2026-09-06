package com.rsa.telemetry.capture

import com.rsa.telemetry.util.Iso8601
import java.util.UUID

/**
 * Turns a raw [TelemetryReading] into the wire-format [TelemetryPacket]. Pure Kotlin (no Android
 * imports) so it can be unit tested on the JVM without an emulator.
 *
 * IMPORTANT: this is only ever called once per reading, at capture time, by
 * [com.rsa.telemetry.service.TelemetryForegroundService]. The generated `packetId` is persisted
 * in the local queue row ([com.rsa.telemetry.data.PacketEntity.packetId]) and is the value that
 * gets resent on every retry -- retries read the already-stored entity back out of Room and never
 * call this factory again, so they never mint a new id for the same reading. The [packetId]
 * parameter below exists only so tests can inject a deterministic value instead of a random one.
 */
object PacketFactory {
    fun createPacket(
        reading: TelemetryReading,
        deviceId: String,
        packetId: String = UUID.randomUUID().toString(),
    ): TelemetryPacket = TelemetryPacket(
        packetId = packetId,
        deviceId = deviceId,
        capturedAt = Iso8601.formatUtc(reading.capturedAtEpochMillis),
        lat = reading.lat,
        lon = reading.lon,
        altitudeM = reading.altitudeM,
        gpsAccuracyM = reading.gpsAccuracyM.toDouble(),
        speedMps = reading.speedMps.toDouble(),
        headingDeg = reading.headingDeg.toDouble(),
        acceleration = Acceleration(
            x = reading.accelX.toDouble(),
            y = reading.accelY.toDouble(),
            z = reading.accelZ.toDouble(),
        ),
        batteryPct = reading.batteryPct,
    )
}
