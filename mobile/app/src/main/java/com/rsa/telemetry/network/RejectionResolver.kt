package com.rsa.telemetry.network

/**
 * Decides what happens to each packet of a batch the server answered with 2xx: which rows may be
 * deleted from the local queue because the server really stored them, and which were refused and
 * must be kept and surfaced instead.
 *
 * Pure Kotlin -- no Android, no Room, no OkHttp -- so the single most consequential decision in
 * the upload path (does this flight data get deleted or not?) is unit testable on the JVM.
 */
object RejectionResolver {

    data class Rejection(val packetId: String, val reason: String)

    data class Split(
        /** Packet ids the server stored, or already had from an earlier retry. Safe to delete. */
        val deliveredIds: List<String>,
        /** Packet ids the server refused, each with the reason it gave. */
        val rejected: List<Rejection>,
        /**
         * Rejections the server reported that could not be matched to any packet in this batch --
         * neither by a known `packet_id` nor by a usable index. They are still counted so the
         * rejection total shown to the pilot never under-reports, but there is no local row to
         * flag with a reason.
         */
        val unresolvedRejections: Int,
    )

    /**
     * [batchPacketIds] must be in the exact order the packets were posted: whenever the server
     * could not echo a `packet_id` back (because that field is what failed validation), the index
     * into that array is the only thing identifying the packet.
     *
     * A null [response] means the body was missing or unparseable. The batch is then treated as
     * fully delivered, since the server answered 2xx and we have no evidence of any rejection --
     * inventing rejections from a parse failure would strand good data in the queue forever.
     */
    fun split(batchPacketIds: List<String>, response: TelemetryBatchResponse?): Split {
        if (response == null || response.rejectedPackets.isEmpty()) {
            return Split(deliveredIds = batchPacketIds, rejected = emptyList(), unresolvedRejections = 0)
        }

        val batchIds = batchPacketIds.toSet()
        val rejected = mutableListOf<Rejection>()
        val rejectedIds = mutableSetOf<String>()
        var unresolved = 0

        for (entry in response.rejectedPackets) {
            val packetId = entry.packetId?.takeIf { it in batchIds }
                ?: batchPacketIds.getOrNull(entry.index)
            if (packetId == null) {
                unresolved++
                continue
            }
            if (rejectedIds.add(packetId)) {
                rejected += Rejection(packetId = packetId, reason = entry.reason)
            }
        }

        return Split(
            deliveredIds = batchPacketIds.filterNot { it in rejectedIds },
            rejected = rejected,
            unresolvedRejections = unresolved,
        )
    }
}
