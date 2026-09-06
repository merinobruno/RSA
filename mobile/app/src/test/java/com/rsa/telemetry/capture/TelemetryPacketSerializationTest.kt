package com.rsa.telemetry.capture

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Guards the exact wire shape the server expects: snake_case field names via `@SerialName`, and
 * a JSON *array* body even for a single packet. A typo in a `@SerialName` would otherwise only
 * surface as a confusing server-side validation failure in the field.
 */
class TelemetryPacketSerializationTest {

    private val json = Json
    private val samplePacket = TelemetryPacket(
        packetId = "11111111-1111-1111-1111-111111111111",
        deviceId = "22222222-2222-2222-2222-222222222222",
        capturedAt = "2026-09-05T14:32:01.000Z",
        lat = -34.6037,
        lon = -58.3816,
        altitudeM = 1200.5,
        gpsAccuracyM = 8.2,
        speedMps = 42.3,
        headingDeg = 187.4,
        acceleration = Acceleration(x = 0.12, y = -0.03, z = 9.81),
        batteryPct = 76,
    )

    @Test
    fun `encodes the exact snake_case keys the server contract requires`() {
        val element = json.encodeToJsonElement(TelemetryPacket.serializer(), samplePacket).jsonObject

        val expectedKeys = setOf(
            "packet_id", "device_id", "captured_at", "lat", "lon", "altitude_m",
            "gps_accuracy_m", "speed_mps", "heading_deg", "acceleration", "battery_pct",
        )
        assertEquals(expectedKeys, element.keys)
        assertEquals("11111111-1111-1111-1111-111111111111", element.getValue("packet_id").jsonPrimitive.content)
        assertEquals(setOf("x", "y", "z"), element.getValue("acceleration").jsonObject.keys)
    }

    @Test
    fun `encodes a batch as a JSON array, as the endpoint requires even for one packet`() {
        val encoded = json.encodeToString(ListSerializer(TelemetryPacket.serializer()), listOf(samplePacket))

        val array = json.parseToJsonElement(encoded).jsonArray
        assertEquals(1, array.size)
        assertTrue(encoded.trim().startsWith("["))
        assertTrue(encoded.trim().endsWith("]"))
    }
}
