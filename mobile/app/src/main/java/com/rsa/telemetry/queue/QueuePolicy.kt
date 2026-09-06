package com.rsa.telemetry.queue

/**
 * Bounds and decisions for the local packet queue. Pure Kotlin, no Android or Room imports, so
 * the thresholds below can be unit tested directly.
 *
 * Sizing rationale for the two trim bounds (see README "Local queue" section for the full
 * writeup): captures happen every 30 seconds, so a full day of continuous outage is
 * 24h * 3600s / 30s = 2880 rows. We trim on two independent axes so that either a very long
 * outage *or* a clock/GPS glitch that stalls trimming doesn't grow the on-disk queue without
 * bound on a phone that may only have a few GB free:
 *
 * - Age: drop anything older than [MAX_PENDING_AGE_MILLIS] (24 hours). A flight this late is not
 *   coming back online to care about that data point; a stale packet is worse than a gap.
 * - Row count: also cap at [MAX_PENDING_ROWS] (3000 rows, ~25 hours at the normal cadence) as a
 *   belt-and-suspenders bound in case device clock jumps make the age check unreliable.
 */
object QueuePolicy {
    const val CAPTURE_INTERVAL_MILLIS: Long = 30_000L

    const val MAX_PENDING_AGE_MILLIS: Long = 24L * 60 * 60 * 1000

    const val MAX_PENDING_ROWS: Int = 3_000

    /** Packets are uploaded in batches this size so one POST body stays bounded after a long
     * outage leaves thousands of rows pending; the loop simply issues more batches. */
    const val UPLOAD_BATCH_SIZE: Int = 200

    /**
     * Floor for the pause between capture cycles, for the case where one cycle overruns
     * [CAPTURE_INTERVAL_MILLIS] entirely (slow GPS fix plus a slow upload on a weak phone). Without
     * it the loop would busy-spin, which on the low-end hardware this targets is the worst possible
     * response to the device already being overloaded.
     */
    const val MIN_CYCLE_DELAY_MILLIS: Long = 1_000L

    /**
     * How long to sleep after a capture cycle that took [tickDurationMillis].
     *
     * Sleeping a flat [CAPTURE_INTERVAL_MILLIS] *after* the work makes the real period
     * `interval + however long the cycle took` -- the GPS fix and the upload both happen inside the
     * cycle. Measured in the field: 31.7s average on a fast phone and 33.0s on a slow one, against a
     * 30s target, drifting further the slower the device or the network. Subtracting the elapsed
     * time holds the cadence at the interval regardless of how slow the device is.
     */
    fun nextDelayMillis(tickDurationMillis: Long): Long =
        (CAPTURE_INTERVAL_MILLIS - tickDurationMillis).coerceAtLeast(MIN_CYCLE_DELAY_MILLIS)

    fun isExpired(capturedAtEpochMillis: Long, nowEpochMillis: Long): Boolean =
        nowEpochMillis - capturedAtEpochMillis > MAX_PENDING_AGE_MILLIS

    /** An upload attempt is only worth making when there is something queued and the device
     * currently believes it has network connectivity. Both the capture loop and the WorkManager
     * retry job funnel through this before touching the network. */
    fun shouldAttemptUpload(pendingCount: Int, hasNetwork: Boolean): Boolean =
        hasNetwork && pendingCount > 0
}
