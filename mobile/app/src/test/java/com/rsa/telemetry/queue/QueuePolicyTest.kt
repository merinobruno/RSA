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
