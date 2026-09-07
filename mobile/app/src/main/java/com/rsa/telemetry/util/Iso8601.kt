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

    /**
     * Argentina, fixed at -03:00 all year (no daylight saving).
     *
     * A fixed offset rather than the device's own time zone on purpose: a phone with the wrong
     * zone set - or one that silently switched while roaming - would relabel every reading, and a
     * timestamp you cannot trust is worse than one you have to convert. This is a display
     * reference the operator can count on, while the wire format stays UTC.
     */
    private val LOCAL_ZONE: ZoneOffset = ZoneOffset.ofHours(-3)

    const val LOCAL_ZONE_LABEL: String = "GMT-3"

    private val LOCAL_FORMATTER: DateTimeFormatter = DateTimeFormatter
        .ofPattern("dd/MM HH:mm:ss")
        .withZone(LOCAL_ZONE)

    fun formatLocal(epochMillis: Long): String = LOCAL_FORMATTER.format(Instant.ofEpochMilli(epochMillis))

    /**
     * Renders a UTC timestamp produced by [formatUtc] in local time for display.
     *
     * The stored value is never converted - only what the human reads is. There is exactly one
     * timestamp in this system, in UTC, and this is a lens onto it.
     */
    fun toLocalDisplay(iso8601Utc: String): String = LOCAL_FORMATTER.format(Instant.parse(iso8601Utc))
}
