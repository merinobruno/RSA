package com.rsa.telemetry.queue

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QueuePolicyTest {

    private val now = 1_800_000_000_000L // arbitrary fixed "now" for deterministic tests

    @Test
    fun `a packet captured just now is not expired`() {
        assertFalse(QueuePolicy.isExpired(capturedAtEpochMillis = now, nowEpochMillis = now))
    }

    @Test
    fun `a packet captured just under 24h ago is not expired`() {
        val capturedAt = now - QueuePolicy.MAX_PENDING_AGE_MILLIS + 1_000
        assertFalse(QueuePolicy.isExpired(capturedAt, now))
    }

    @Test
    fun `a packet captured exactly 24h ago is not yet expired`() {
        val capturedAt = now - QueuePolicy.MAX_PENDING_AGE_MILLIS
        assertFalse(QueuePolicy.isExpired(capturedAt, now))
    }

    @Test
    fun `a packet captured just over 24h ago is expired`() {
        val capturedAt = now - QueuePolicy.MAX_PENDING_AGE_MILLIS - 1_000
        assertTrue(QueuePolicy.isExpired(capturedAt, now))
    }

    @Test
    fun `never uploads when nothing is queued, even with network`() {
        assertFalse(QueuePolicy.shouldAttemptUpload(pendingCount = 0, hasNetwork = true))
    }

    @Test
    fun `never uploads without network, even with a full queue`() {
        assertFalse(QueuePolicy.shouldAttemptUpload(pendingCount = 500, hasNetwork = false))
    }

    @Test
    fun `uploads when something is queued and network is available`() {
        assertTrue(QueuePolicy.shouldAttemptUpload(pendingCount = 1, hasNetwork = true))
    }

    @Test
    fun `an instant cycle waits the full interval`() {
        assertEquals(QueuePolicy.CAPTURE_INTERVAL_MILLIS, QueuePolicy.nextDelayMillis(0))
    }

    @Test
    fun `a slow cycle has its own duration subtracted, holding the cadence at the interval`() {
        // This matters far more at 1 Hz than it did at 30s: a cycle costing a fifth of the interval
        // would cost a fifth of the capture rate if it were not subtracted.
        val tick = QueuePolicy.CAPTURE_INTERVAL_MILLIS / 5
        assertEquals(QueuePolicy.CAPTURE_INTERVAL_MILLIS - tick, QueuePolicy.nextDelayMillis(tick))
    }

    @Test
    fun `a cycle that overruns the interval still yields to the floor, never busy-spins`() {
        val overrun = QueuePolicy.CAPTURE_INTERVAL_MILLIS + 10_000L
        assertEquals(QueuePolicy.MIN_CYCLE_DELAY_MILLIS, QueuePolicy.nextDelayMillis(overrun))
    }

    @Test
    fun `a cycle taking exactly the interval yields to the floor rather than zero`() {
        assertEquals(
            QueuePolicy.MIN_CYCLE_DELAY_MILLIS,
            QueuePolicy.nextDelayMillis(QueuePolicy.CAPTURE_INTERVAL_MILLIS),
        )
    }

    @Test
    fun `batch size drains a full queue in a bounded number of requests`() {
        // Each request pays a fixed connection cost - measured at ~10s on the weak phone - so the
        // request count, not the packet count, is what decides how long a drain takes. A full 24h
        // queue should still empty in minutes rather than hours.
        val worstCaseBatchCount =
            (QueuePolicy.MAX_PENDING_ROWS + QueuePolicy.UPLOAD_BATCH_SIZE - 1) / QueuePolicy.UPLOAD_BATCH_SIZE

        assertTrue("draining a full queue takes $worstCaseBatchCount requests, too many", worstCaseBatchCount <= 200)
    }

    @Test
    fun `the row cap holds a full day at the capture rate`() {
        // This is the constant that silently discards flight data if it falls behind the capture
        // rate. It was 3,000 when captures were every 30s (25 hours); at 1 Hz that same number
        // would have held 50 minutes, against a 62-minute outage actually recorded in the field.
        val rowsPerDay = 24 * 60 * 60 * 1000L / QueuePolicy.CAPTURE_INTERVAL_MILLIS

        assertTrue(
            "row cap ${QueuePolicy.MAX_PENDING_ROWS} holds less than the $rowsPerDay the age limit allows",
            QueuePolicy.MAX_PENDING_ROWS >= rowsPerDay
        )
    }

    @Test
    fun `a fix may not be older than a few capture intervals`() {
        // The staleness bound is what stops a stalled location stream from replaying the last
        // known position once per second across a gap. Loose enough for stream jitter, tight
        // enough that a recorded position is a recent one.
        assertTrue(QueuePolicy.MAX_FIX_AGE_MILLIS > QueuePolicy.CAPTURE_INTERVAL_MILLIS)
        assertTrue(QueuePolicy.MAX_FIX_AGE_MILLIS <= 5 * QueuePolicy.CAPTURE_INTERVAL_MILLIS)
    }

    @Test
    fun `uploads are far less frequent than captures, which is the point of decoupling them`() {
        assertTrue(QueuePolicy.UPLOAD_INTERVAL_MILLIS > QueuePolicy.CAPTURE_INTERVAL_MILLIS * 10)
    }

    // -- Stationary heartbeat ------------------------------------------------------------------
    //
    // A phone left running in an office records 28,800 rows in eight hours, all of them the same
    // place. Measured at 338 bytes a row on the server, that is 9.3 MiB of nothing per phone per
    // eight hours - and a day of 1 Hz capture is 27.8 MiB, which fills a small managed database in
    // a couple of weeks. So while nothing is moving, one packet every 30 s instead of every second.

    private val moving = QueuePolicy.MOVING_SPEED_MPS + 10f
    private val still = 0f

    @Test
    fun `enqueues the very first reading, whatever its speed`() {
        assertTrue(QueuePolicy.shouldEnqueue(still, now, lastEnqueuedAtEpochMillis = 0L))
    }

    @Test
    fun `enqueues every reading while moving, holding 1 Hz where it matters`() {
        assertTrue(QueuePolicy.shouldEnqueue(moving, now, lastEnqueuedAtEpochMillis = now - 1_000))
    }

    @Test
    fun `skips a motionless reading taken before the heartbeat is due`() {
        assertFalse(QueuePolicy.shouldEnqueue(still, now, lastEnqueuedAtEpochMillis = now - 1_000))
    }

    @Test
    fun `enqueues a motionless reading once the heartbeat is due`() {
        val lastEnqueued = now - QueuePolicy.STATIONARY_HEARTBEAT_MILLIS
        assertTrue(QueuePolicy.shouldEnqueue(still, now, lastEnqueued))
    }

    @Test
    fun `treats exactly the moving threshold as not moving, as the server does`() {
        // The server's segmentation counts a point as moving on `speed > MOVING_SPEED_MPS`, strictly
        // greater. Matching it keeps one definition of "moving" across the phone and the server.
        assertFalse(
            QueuePolicy.shouldEnqueue(QueuePolicy.MOVING_SPEED_MPS, now, lastEnqueuedAtEpochMillis = now - 1_000)
        )
    }

    @Test
    fun `resumes 1 Hz on the first moving reading, so no taxi or takeoff roll is lost`() {
        // The location stream keeps running at 1 Hz while throttled - only the queueing is paused -
        // so movement is seen within one second of starting, not within one heartbeat.
        val justEnqueued = now - 1_000

        assertFalse(QueuePolicy.shouldEnqueue(still, now, justEnqueued))
        assertTrue(QueuePolicy.shouldEnqueue(moving, now + 1_000, justEnqueued))
    }

    @Test
    fun `a noise spike while parked costs one extra packet and nothing else`() {
        // A motionless receiver reports speed jittering around zero and will occasionally read above
        // the threshold. Because the rule looks only at this reading and the last one queued, such a
        // spike cannot reset a mode or postpone the heartbeat - there is no mode to reset.
        val lastEnqueued = now - 1_000

        assertTrue(QueuePolicy.shouldEnqueue(moving, now, lastEnqueued))
        assertFalse(QueuePolicy.shouldEnqueue(still, now + 1_000, lastEnqueued))
    }

    @Test
    fun `the heartbeat is far shorter than the stationary stretch the server splits on`() {
        // The load-bearing invariant. The server ends a flight after 10 minutes of stationary points
        // but needs more than 15 minutes of SILENCE to end one - so if the phone simply stopped
        // sending while parked, a stop of 10 to 15 minutes would produce neither signal and two
        // separate outings would be merged into one flight. Verified against segmentStream: a
        // 12-minute stop yields 2 flights today and with this heartbeat, but 1 if the packets are
        // dropped entirely. The heartbeat is what keeps the stationary run visible.
        val serverStationarySplitMillis = 10 * 60 * 1000L

        assertTrue(
            "a ${QueuePolicy.STATIONARY_HEARTBEAT_MILLIS} ms heartbeat is too slow to keep a parked " +
                "stretch visible to the server's segmentation",
            QueuePolicy.STATIONARY_HEARTBEAT_MILLIS <= serverStationarySplitMillis / 10
        )
    }

    @Test
    fun `a heartbeat still beats capturing nothing at all while parked`() {
        assertTrue(QueuePolicy.STATIONARY_HEARTBEAT_MILLIS > QueuePolicy.CAPTURE_INTERVAL_MILLIS)
    }

    @Test
    fun `a day of tracking with two hours of flying queues a small fraction of 1 Hz`() {
        // The whole point, driven through the real rule rather than argued about: the tracker is
        // switched on in the morning and left on, and the aircraft flies for two of the ten hours.
        val stationaryHours = 8
        val movingHours = 2
        var lastEnqueued = 0L
        var queued = 0

        var t = now
        repeat(stationaryHours * 3600) {
            if (QueuePolicy.shouldEnqueue(still, t, lastEnqueued)) {
                queued++
                lastEnqueued = t
            }
            t += QueuePolicy.CAPTURE_INTERVAL_MILLIS
        }
        repeat(movingHours * 3600) {
            if (QueuePolicy.shouldEnqueue(moving, t, lastEnqueued)) {
                queued++
                lastEnqueued = t
            }
            t += QueuePolicy.CAPTURE_INTERVAL_MILLIS
        }

        val atFullRate = (stationaryHours + movingHours) * 3600
        // Every second of flight is kept - that half is not negotiable - and the parked half
        // collapses to one packet per heartbeat.
        val expected = movingHours * 3600 + stationaryHours * 3600 / (QueuePolicy.STATIONARY_HEARTBEAT_MILLIS / 1000).toInt()

        assertEquals(expected, queued)
        assertTrue("$queued of $atFullRate is not a saving worth the code", queued < atFullRate / 3)
    }

    @Test
    fun `a clock that jumps backwards does not wedge the heartbeat off`() {
        // System.currentTimeMillis() is not monotonic: an NTP correction mid-flight can put "now"
        // behind the last queued packet. That must not be able to stop the heartbeat forever.
        val lastEnqueued = now + 60_000

        assertTrue(QueuePolicy.shouldEnqueue(still, now, lastEnqueued))
    }

    @Test
    fun `one upload interval of captures fits comfortably in a single batch`() {
        // Steady state with network: every flush should be one request, never several.
        val capturesPerUpload = QueuePolicy.UPLOAD_INTERVAL_MILLIS / QueuePolicy.CAPTURE_INTERVAL_MILLIS

        assertTrue(
            "$capturesPerUpload captures per upload does not fit a ${QueuePolicy.UPLOAD_BATCH_SIZE} batch",
            capturesPerUpload <= QueuePolicy.UPLOAD_BATCH_SIZE
        )
    }
}
