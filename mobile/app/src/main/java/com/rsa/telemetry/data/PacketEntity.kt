package com.rsa.telemetry.data

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.rsa.telemetry.capture.Acceleration
import com.rsa.telemetry.capture.TelemetryPacket
import com.rsa.telemetry.queue.PacketStatus

/**
 * Local queue row: every field of the wire-format [TelemetryPacket], plus [status] and a
 * denormalized [capturedAtEpochMillis] used for ordering and trimming (kept separate from the
 * formatted [capturedAt] string so queries never need to reparse it).
 *
 * Room entity annotations are plain JVM metadata (no Android platform dependency), so this class
 * is freely constructible from JVM unit tests.
 */
@Entity(tableName = "packets")
data class PacketEntity(
    @PrimaryKey val packetId: String,
    val deviceId: String,
    val capturedAt: String,
    val capturedAtEpochMillis: Long,
    val lat: Double,
    val lon: Double,
    val altitudeM: Double,
    val gpsAccuracyM: Double,
    val speedMps: Double,
    val headingDeg: Double,
    val accelX: Double,
    val accelY: Double,
    val accelZ: Double,
    val batteryPct: Int,
    val status: String = PacketStatus.PENDING.name,
    /** Why the server refused this packet. Non-null only on [PacketStatus.REJECTED] rows. */
    val rejectionReason: String? = null,
)

fun TelemetryPacket.toEntity(
    capturedAtEpochMillis: Long,
    status: PacketStatus = PacketStatus.PENDING,
): PacketEntity = PacketEntity(
    packetId = packetId,
    deviceId = deviceId,
    capturedAt = capturedAt,
    capturedAtEpochMillis = capturedAtEpochMillis,
    lat = lat,
    lon = lon,
    altitudeM = altitudeM,
    gpsAccuracyM = gpsAccuracyM,
    speedMps = speedMps,
    headingDeg = headingDeg,
    accelX = acceleration.x,
    accelY = acceleration.y,
    accelZ = acceleration.z,
    batteryPct = batteryPct,
    status = status.name,
)

fun PacketEntity.toPacket(): TelemetryPacket = TelemetryPacket(
    packetId = packetId,
    deviceId = deviceId,
    capturedAt = capturedAt,
    lat = lat,
    lon = lon,
    altitudeM = altitudeM,
    gpsAccuracyM = gpsAccuracyM,
    speedMps = speedMps,
    headingDeg = headingDeg,
    acceleration = Acceleration(accelX, accelY, accelZ),
    batteryPct = batteryPct,
)
