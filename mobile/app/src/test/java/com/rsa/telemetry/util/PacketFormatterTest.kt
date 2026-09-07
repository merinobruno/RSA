package com.rsa.telemetry.util

import com.rsa.telemetry.capture.Acceleration
import com.rsa.telemetry.capture.TelemetryPacket
import java.util.Locale
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class PacketFormatterTest {

    private val original = Locale.getDefault()

    private val packet = TelemetryPacket(
        packetId = "3f1c2b8e-0000-4000-8000-000000000001",
        deviceId = "8e29ad17-e9a9-484e-8087-15bb24390f67",
        capturedAt = "2026-09-07T12:34:56.789Z",
        lat = -38.9315414,
        lon = -67.9758189,
        altitudeM = 285.3,
        gpsAccuracyM = 14.25,
        speedMps = 31.5,
        headingDeg = 142.75,
        acceleration = Acceleration(x = 1.5, y = -2.25, z = 8.125),
        batteryPct = 77,
    )

    /**
     * The device this runs on is set to es-AR, where the default number formatting uses a comma as
     * the decimal separator. A coordinate rendered as "-38,931541" beside a comma-separated
     * lat/lon pair is unreadable and cannot be pasted into a map, and it would not match the dot
     * the packet actually puts on the wire. So the formatter must not follow the device locale.
     */
    @Before
    fun useACommaDecimalLocale() {
        Locale.setDefault(Locale.forLanguageTag("es-AR"))
    }

    @After
    fun restoreLocale() {
        Locale.setDefault(original)
    }

    @Test
    fun `renders coordinates with dot decimals regardless of a comma-decimal device locale`() {
        val out = PacketFormatter.format(packet)

        assertTrue("expected dot decimals, got:\n$out", out.contains("-38.931541, -67.975819"))
        assertTrue("latitude must not use a comma decimal separator", !out.contains("-38,93"))
    }

    @Test
    fun `shows speed in both m per s and km per h`() {
        val out = PacketFormatter.format(packet)

        assertTrue(out.contains("31.5 m/s"))
        // 31.5 m/s is 113.4 km/h, rounded for display.
        assertTrue("expected a km/h conversion, got:\n$out", out.contains("113 km/h"))
    }

    @Test
    fun `signs every acceleration axis so a negative reading is unmistakable`() {
        val out = PacketFormatter.format(packet)

        assertTrue(out.contains("x +1.50"))
        assertTrue(out.contains("y -2.25"))
        assertTrue(out.contains("z +8.13"))
    }

    @Test
    fun `includes every field that goes on the wire`() {
        val out = PacketFormatter.format(packet)

        for (label in listOf("time", "position", "accuracy", "altitude", "speed", "heading", "accel", "battery", "packet")) {
            assertTrue("missing the $label row in:\n$out", out.contains(label))
        }
        assertTrue(out.contains(packet.capturedAt))
        assertTrue(out.contains(packet.packetId))
        assertTrue(out.contains("77%"))
    }

    @Test
    fun `keeps the labels aligned so the values line up in a column`() {
        val valueColumns = PacketFormatter.format(packet)
            .lines()
            .map { line -> line.indexOf(line.trim().split(Regex("\\s{2,}"))[1].first()) }

        assertTrue("every value should start at the same column", valueColumns.distinct().size == 1)
    }
}
