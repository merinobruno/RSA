package com.rsa.telemetry.queue

/**
 * Bounds and decisions for the local packet queue. Pure Kotlin, no Android or Room imports, so the
 * thresholds below can be unit tested directly.
 *
 * Capture and upload are deliberately decoupled. Capturing at 1 Hz is what makes the track usable:
 * at 200 km/h a 30-second sample is a point every 1.7 km, which cannot show a turn, a circuit or a
 * descent - the manoeuvre simply is not in the data. At 1 Hz it is a point every 55 m, which is
 * also what ADS-B uses.
 *
 * Uploading stays at 30 seconds because the cost of an upload is almost entirely establishing the
 * connection - waking the radio, the TLS handshake - and that is paid once per REQUEST, not per
 * packet. Measured in the field: 1.0 s median on a good phone, 9.8 s on a weak one, near enough
 * independent of payload. So 30 packets in one POST cost what one packet did, and raising the
 * capture rate 30x leaves the request count untouched.
 */
object QueuePolicy {
    /** How often a reading is taken. See the class note for why this is 1 Hz. */
    const val CAPTURE_INTERVAL_MILLIS: Long = 1_000L

    /** How often the queue is flushed to the server, and trimmed. */
    const val UPLOAD_INTERVAL_MILLIS: Long = 30_000L

    /**
     * How stale a fix may be and still be recorded.
     *
     * With a continuous location stream the latest fix is always available, which is convenient
     * and dangerous: if the stream stops delivering (indoors, no sky, receiver lost), reusing the
     * last known position would manufacture a point every second at a place the aircraft has
     * already left. This is the guard that keeps a signal gap an honest gap. Three capture
     * intervals is loose enough to tolerate jitter in the stream and tight enough that a recorded
     * position is always a recent one.
     */
    const val MAX_FIX_AGE_MILLIS: Long = 3 * CAPTURE_INTERVAL_MILLIS

    const val MAX_PENDING_AGE_MILLIS: Long = 24L * 60 * 60 * 1000

    /**
     * Row cap for the local queue: 24 hours at 1 Hz.
     *
     * This had to grow with the capture rate, and it is not a detail. At the old 30-second cadence
     * the previous cap of 3,000 rows held 25 hours; at 1 Hz it would hold **50 minutes**. A real
     * outage of 62 minutes was recorded in the field the day before this changed, so the old cap
     * would have silently discarded flight data during an outage the queue exists precisely to
     * survive. At roughly 200 bytes a row this is about 17 MB of SQLite - nothing on any phone.
     */
    const val MAX_PENDING_ROWS: Int = 86_400

    /**
     * Packets per upload request.
     *
     * Larger than it was, because draining an outage now means far more rows and each request pays
     * that fixed connection cost: an hour of backlog is ~3,600 packets, which is 8 requests at this
     * size against 18 at the old one - and on a phone paying ~10 s per request, that difference is
     * minutes. Kept well below the server's body limit so a batch never fails for size.
     */
    const val UPLOAD_BATCH_SIZE: Int = 500

    /**
     * Floor for the pause between capture cycles, for the case where one cycle overruns
     * [CAPTURE_INTERVAL_MILLIS]. Without it the loop would busy-spin, which on the low-end hardware
     * this targets is the worst possible response to the device already being overloaded. Small
     * relative to the interval so it does not distort the cadence when a cycle merely runs long.
     */
    const val MIN_CYCLE_DELAY_MILLIS: Long = 100L

    /**
     * How long to sleep after a capture cycle that took [tickDurationMillis].
     *
     * Sleeping a flat [CAPTURE_INTERVAL_MILLIS] *after* the work makes the real period
     * `interval + however long the cycle took`. Measured in the field before this existed: 31.7 s
     * on a fast phone and 33.0 s on a slow one against a 30 s target, drifting further the slower
     * the device. Subtracting the elapsed time holds the cadence regardless of device speed - which
     * matters far more at 1 Hz, where even a 200 ms cycle would otherwise cost 20% of the rate.
     */
    fun nextDelayMillis(tickDurationMillis: Long): Long =
        (CAPTURE_INTERVAL_MILLIS - tickDurationMillis).coerceAtLeast(MIN_CYCLE_DELAY_MILLIS)

    fun isExpired(capturedAtEpochMillis: Long, nowEpochMillis: Long): Boolean =
        nowEpochMillis - capturedAtEpochMillis > MAX_PENDING_AGE_MILLIS

    /** An upload attempt is only worth making when there is something queued and the device
     * currently believes it has network connectivity. Both the upload loop and the WorkManager
     * retry job funnel through this before touching the network. */
    fun shouldAttemptUpload(pendingCount: Int, hasNetwork: Boolean): Boolean =
        hasNetwork && pendingCount > 0
}
