package com.rsa.telemetry.util

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

class Iso8601Test {

    @Test
    fun `formats a known instant exactly like the server contract example`() {
        // 2026-09-05T14:32:01.000Z from the task's example packet.
        val epochMillis = Instant.parse("2026-09-05T14:32:01.000Z").toEpochMilli()

        val formatted = Iso8601.formatUtc(epochMillis)

        assertEquals("2026-09-05T14:32:01.000Z", formatted)
    }

    @Test
    fun `always includes exactly three millisecond digits even when they are zero`() {
        val epochMillis = Instant.parse("2026-01-01T00:00:00.000Z").toEpochMilli()

        val formatted = Iso8601.formatUtc(epochMillis)

        assertEquals("2026-01-01T00:00:00.000Z", formatted)
    }

    @Test
    fun `preserves non-zero milliseconds`() {
        val epochMillis = Instant.parse("2026-03-14T09:26:53.007Z").toEpochMilli()

        val formatted = Iso8601.formatUtc(epochMillis)

        assertEquals("2026-03-14T09:26:53.007Z", formatted)
    }

    @Test
    fun `formats in UTC regardless of the JVM default time zone`() {
        val epochMillis = 0L // 1970-01-01T00:00:00.000Z

        val formatted = Iso8601.formatUtc(epochMillis)

        assertEquals("1970-01-01T00:00:00.000Z", formatted)
    }
}
