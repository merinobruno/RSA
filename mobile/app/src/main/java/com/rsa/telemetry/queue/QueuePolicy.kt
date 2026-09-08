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

    /**
     * Below this a reading counts as not moving. 2 m/s is 7 km/h.
     *
     * The same number, and the same strict comparison, as `MOVING_SPEED_MPS` in the server's
     * flight segmentation. One definition of "moving" across both halves of the system: a reading
     * the server would discard as stationary is not one worth sending sixty times a minute.
     */
    const val MOVING_SPEED_MPS: Float = 2f

    /**
     * How often a packet is queued while nothing is moving.
     *
     * At 1 Hz a phone left running in an office records 28,800 rows in eight hours, every one of
     * them the same place - 9.3 MiB on the server, measured at 338 bytes a row, and a full day of
     * capture is 27.8 MiB per device. Three phones fill a small managed database in a fortnight.
     *
     * The alternative was to queue nothing at all while parked, and that quietly breaks flight
     * segmentation. The server ends a flight after ten minutes of stationary POINTS but needs more
     * than fifteen minutes of SILENCE to end one, so a stop between those two lengths would raise
     * neither signal and two separate outings would be merged into one flight - verified against
     * segmentStream, where a twelve-minute stop yields two flights with this heartbeat and one
     * without it.
     *
     * Silence is also ambiguous in a way that matters for an aircraft: a phone that has deliberately
     * stopped sending is indistinguishable from one that died, lost signal, or froze. A heartbeat
     * says "still here, still at this spot", which is the thing you want on the record.
     */
    const val STATIONARY_HEARTBEAT_MILLIS: Long = 30_000L

    /**
     * Whether a reading is worth queueing.
     *
     * Stateless by design - it looks only at this reading and the instant of the last one queued.
     * A stationary receiver reports speed jittering around zero and will occasionally read above
     * the threshold; with no mode to fall out of, such a spike costs one extra packet instead of
     * postponing the heartbeat or dropping the phone back to 1 Hz for a while.
     *
     * Note what this does NOT change: the location stream and the capture loop keep running at
     * 1 Hz. Only the queueing is throttled, so the first moving reading is seen within a second and
     * no part of a taxi or a takeoff roll is lost to the throttle.
     */
    fun shouldEnqueue(
        speedMps: Float,
        atEpochMillis: Long,
        lastEnqueuedAtEpochMillis: Long,
    ): Boolean {
        if (lastEnqueuedAtEpochMillis == 0L) return true
        if (speedMps > MOVING_SPEED_MPS) return true
        // Absolute difference, because System.currentTimeMillis() is not monotonic: an NTP
        // correction can put "now" behind the last queued packet, and a plain subtraction would
        // then stay negative and hold the heartbeat off until the clock caught up.
        val sinceLast = atEpochMillis - lastEnqueuedAtEpochMillis
        if (sinceLast < 0) return true
        return sinceLast >= STATIONARY_HEARTBEAT_MILLIS
    }

    fun isExpired(capturedAtEpochMillis: Long, nowEpochMillis: Long): Boolean =
        nowEpochMillis - capturedAtEpochMillis > MAX_PENDING_AGE_MILLIS

    /** An upload attempt is only worth making when there is something queued and the device
     * currently believes it has network connectivity. Both the upload loop and the WorkManager
     * retry job funnel through this before touching the network. */
    fun shouldAttemptUpload(pendingCount: Int, hasNetwork: Boolean): Boolean =
        hasNetwork && pendingCount > 0
}
