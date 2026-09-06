package com.rsa.telemetry.capture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import java.time.Instant

class PacketFactoryTest {

    private val sampleReading = TelemetryReading(
        capturedAtEpochMillis = Instant.parse("2026-09-05T14:32:01.000Z").toEpochMilli(),
        lat = -34.6037,
        lon = -58.3816,
        altitudeM = 1200.5,
        gpsAccuracyM = 8.2f,
        speedMps = 42.3f,
        headingDeg = 187.4f,
        accelX = 0.12f,
        accelY = -0.03f,
        accelZ = 9.81f,
        batteryPct = 76,
    )

    @Test
    fun `maps every reading field onto the matching packet field`() {
        val packet = PacketFactory.createPacket(sampleReading, deviceId = "device-123", packetId = "packet-abc")

        assertEquals("packet-abc", packet.packetId)
        assertEquals("device-123", packet.deviceId)
        assertEquals("2026-09-05T14:32:01.000Z", packet.capturedAt)
        assertEquals(-34.6037, packet.lat, 0.0)
        assertEquals(-58.3816, packet.lon, 0.0)
        assertEquals(1200.5, packet.altitudeM, 0.0)
        assertEquals(8.2, packet.gpsAccuracyM, 0.0001)
        assertEquals(42.3, packet.speedMps, 0.0001)
        assertEquals(187.4, packet.headingDeg, 0.0001)
        assertEquals(0.12, packet.acceleration.x, 0.0001)
        assertEquals(-0.03, packet.acceleration.y, 0.0001)
        assertEquals(9.81, packet.acceleration.z, 0.0001)
        assertEquals(76, packet.batteryPct)
    }

    @Test
    fun `generates a fresh packet id when none is supplied`() {
        val first = PacketFactory.createPacket(sampleReading, deviceId = "device-123")
        val second = PacketFactory.createPacket(sampleReading, deviceId = "device-123")

        assertNotEquals(
            "each capture must mint its own id; retries must reuse the stored id instead of " +
                "calling this factory again (see PacketFactory KDoc)",
            first.packetId,
            second.packetId,
        )
    }

    @Test
    fun `reuses an explicitly supplied packet id instead of generating one`() {
        val packet = PacketFactory.createPacket(sampleReading, deviceId = "device-123", packetId = "fixed-id")

        assertEquals("fixed-id", packet.packetId)
    }
}
