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
     * The device runs es-AR, where default number formatting uses a comma decimal separator. A
     * coordinate rendered "-38,931541" is unreadable, cannot be pasted into a map, and would not
     * match the dot the packet puts on the wire. Forcing the locale here keeps that pinned.
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
    fun `shows the time in local GMT-3, not the UTC the packet carries`() {
        val out = PacketFormatter.format(packet)

        // 12:34:56 UTC is 09:34:56 at -03:00.
        assertTrue("expected local 09:34:56, got:\n$out", out.contains("07/09 09:34:56 GMT-3"))
        assertTrue("the raw UTC stamp should not be shown to the operator", !out.contains("12:34:56"))
    }

    @Test
    fun `renders coordinates with dot decimals regardless of a comma-decimal device locale`() {
        val out = PacketFormatter.format(packet)

        assertTrue("expected dot decimals, got:\n$out", out.contains("-38.931541"))
        assertTrue("expected dot decimals, got:\n$out", out.contains("-67.975819"))
        assertTrue("latitude must not use a comma decimal separator", !out.contains("-38,93"))
    }

    @Test
    fun `shows speed in km per h, the unit a person reads`() {
        val out = PacketFormatter.format(packet)

        // 31.5 m/s is 113.4 km/h.
        assertTrue("expected km/h, got:\n$out", out.contains("113 km/h"))
        assertTrue("m/s belongs on the wire, not on the screen", !out.contains("m/s"))
    }

    @Test
    fun `signs every acceleration axis so a negative reading is unmistakable`() {
        val out = PacketFormatter.format(packet)

        assertTrue("expected signed axes, got:\n$out", out.contains("+1.50 -2.25 +8.13"))
    }

    @Test
    fun `includes every field a person needs to sanity-check a capture`() {
        val out = PacketFormatter.format(packet)

        for (label in listOf("time", "speed", "heading", "altitude", "battery", "lat", "lon", "accuracy", "accel")) {
            assertTrue("missing the $label row in:\n$out", out.lines().any { it.startsWith(label) })
        }
        assertTrue(out.contains("77%"))
    }

    @Test
    fun `keeps every row within a width a narrow phone can show at a large font`() {
        // The panel scrolls sideways, but a value the operator has to scroll to reach is a value
        // they will not read. Roughly 30 monospace characters fits a 360dp screen at 18sp.
        val widest = PacketFormatter.format(packet).lines().maxOf { it.length }

        assertTrue("widest row is $widest characters, too wide to read at a glance", widest <= 30)
    }

    @Test
    fun `aligns every value at the same column`() {
        // The label is padded to a fixed width and followed by one space, so every value starts at
        // the same index. Ragged values are exactly what makes a block like this hard to scan.
        val valueColumn = 9

        for (line in PacketFormatter.format(packet).lines()) {
            assertTrue("line too short to hold a value: '$line'", line.length > valueColumn)
            assertTrue("label overruns the column in: '$line'", line[valueColumn - 1] == ' ')
            assertTrue("value does not start at column $valueColumn in: '$line'", line[valueColumn] != ' ')
        }
    }
}
