package com.rsa.telemetry.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * These cases guard the decision that actually destroys data: which queued packets get deleted
 * after the server answers 2xx. Getting it wrong in the permissive direction silently erases
 * flight data behind a healthy-looking screen.
 */
class RejectionResolverTest {

    private val batch = listOf("id-0", "id-1", "id-2")

    @Test
    fun `a response with no rejections delivers the whole batch`() {
        val split = RejectionResolver.split(batch, TelemetryBatchResponse(received = 3, accepted = 3))

        assertEquals(batch, split.deliveredIds)
        assertTrue(split.rejected.isEmpty())
        assertEquals(0, split.unresolvedRejections)
    }

    @Test
    fun `an unparseable body is treated as fully delivered, not as rejections`() {
        // The server committed to the batch with a 2xx; inventing rejections from a parse failure
        // would strand good data in the queue forever.
        val split = RejectionResolver.split(batch, response = null)

        assertEquals(batch, split.deliveredIds)
        assertTrue(split.rejected.isEmpty())
        assertEquals(0, split.unresolvedRejections)
    }

    @Test
    fun `a packet rejected by id is excluded from delivered and keeps its reason`() {
        val response = TelemetryBatchResponse(
            rejected = 1,
            rejectedPackets = listOf(
                RejectedPacket(index = 1, packetId = "id-1", reason = "altitude_m must be >= -1000"),
            ),
        )

        val split = RejectionResolver.split(batch, response)

        assertEquals(listOf("id-0", "id-2"), split.deliveredIds)
        assertEquals(1, split.rejected.size)
        assertEquals("id-1", split.rejected[0].packetId)
        assertEquals("altitude_m must be >= -1000", split.rejected[0].reason)
        assertEquals(0, split.unresolvedRejections)
    }

    @Test
    fun `a packet whose own id failed validation is resolved by its index`() {
        // The server cannot echo back a packet_id that is itself the invalid field, so it omits
        // it and the index is the only handle on that row.
        val response = TelemetryBatchResponse(
            rejected = 1,
            rejectedPackets = listOf(
                RejectedPacket(index = 2, packetId = null, reason = "packet_id must be a valid UUID v4"),
            ),
        )

        val split = RejectionResolver.split(batch, response)

        assertEquals(listOf("id-0", "id-1"), split.deliveredIds)
        assertEquals(listOf("id-2"), split.rejected.map { it.packetId })
    }

    @Test
    fun `an id that is not in this batch falls back to the index`() {
        val response = TelemetryBatchResponse(
            rejected = 1,
            rejectedPackets = listOf(
                RejectedPacket(index = 0, packetId = "some-other-batch-id", reason = "lat must be <= 90"),
            ),
        )

        val split = RejectionResolver.split(batch, response)

        assertEquals(listOf("id-1", "id-2"), split.deliveredIds)
        assertEquals(listOf("id-0"), split.rejected.map { it.packetId })
    }

    @Test
    fun `a rejection matching neither id nor index is counted but never attributed`() {
        val response = TelemetryBatchResponse(
            rejected = 1,
            rejectedPackets = listOf(
                RejectedPacket(index = 99, packetId = "unknown-id", reason = "lat must be a number"),
            ),
        )

        val split = RejectionResolver.split(batch, response)

        // Nothing is flagged on a guess, but the count still reaches the pilot rather than
        // vanishing because the server phrased it in a way this version cannot map.
        assertTrue(split.rejected.isEmpty())
        assertEquals(1, split.unresolvedRejections)
        assertEquals(batch, split.deliveredIds)
    }

    @Test
    fun `the same packet reported twice is only counted once`() {
        val response = TelemetryBatchResponse(
            rejected = 2,
            rejectedPackets = listOf(
                RejectedPacket(index = 1, packetId = "id-1", reason = "lon must be >= -180"),
                RejectedPacket(index = 1, packetId = "id-1", reason = "lon must be >= -180"),
            ),
        )

        val split = RejectionResolver.split(batch, response)

        assertEquals(1, split.rejected.size)
        assertEquals(listOf("id-0", "id-2"), split.deliveredIds)
    }

    @Test
    fun `every packet of a fully rejected batch leaves the pending set`() {
        // The upload loop re-reads pending rows until none are left; if a rejected packet stayed
        // both undelivered and unflagged, that loop would spin on it forever.
        val response = TelemetryBatchResponse(
            rejected = 3,
            rejectedPackets = batch.mapIndexed { index, id ->
                RejectedPacket(index = index, packetId = id, reason = "battery_pct must be <= 100")
            },
        )

        val split = RejectionResolver.split(batch, response)

        assertTrue(split.deliveredIds.isEmpty())
        assertEquals(batch, split.rejected.map { it.packetId })
    }
}
