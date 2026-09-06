package com.rsa.telemetry.util

import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * Formats instants as ISO-8601 UTC with a fixed 3-digit millisecond field and a literal "Z"
 * offset, e.g. "2026-09-05T14:32:01.000Z" -- matching the server's expected `captured_at` format
 * exactly. [Instant.toString] is intentionally not used here: it omits the fractional-second
 * field entirely when it is zero and prints a variable number of digits otherwise, which would
 * make packets captured on an exact second look different from the rest and is harder to assert
 * on in tests.
 *
 * Plain `java.time`, no Android dependency, so this is usable from JVM unit tests unchanged.
 */
object Iso8601 {
    private val FORMATTER: DateTimeFormatter = DateTimeFormatter
        .ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
        .withZone(ZoneOffset.UTC)

    fun formatUtc(epochMillis: Long): String = FORMATTER.format(Instant.ofEpochMilli(epochMillis))
}
