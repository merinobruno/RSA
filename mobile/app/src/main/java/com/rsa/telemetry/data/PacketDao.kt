package com.rsa.telemetry.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

/**
 * All queries below hardcode their status literal (`'PENDING'` or `'REJECTED'`) rather than taking
 * it as a parameter: each caller works with exactly one status, so a parameter would be unused
 * flexibility. Keeping the literal in the SQL also sidesteps relying on Kotlin
 * default-parameter-value resolution against a Room/KSP-generated interface implementation, which
 * was not worth the risk for something with no actual use case yet.
 */
@Dao
interface PacketDao {

    @Insert
    suspend fun insert(entity: PacketEntity)

    @Query("SELECT * FROM packets WHERE status = 'PENDING' ORDER BY capturedAtEpochMillis ASC LIMIT :limit")
    suspend fun fetchPending(limit: Int): List<PacketEntity>

    @Query("SELECT COUNT(*) FROM packets WHERE status = 'PENDING'")
    suspend fun countPending(): Int

    /** Observable pending count for the main screen's live status display. */
    @Query("SELECT COUNT(*) FROM packets WHERE status = 'PENDING'")
    fun observePendingCount(): Flow<Int>

    /**
     * Marks packets sent by deleting them outright rather than flagging + purging later: the
     * server dedupes by `packet_id` (see server contract), so there is no value in keeping a
     * local record of what was already delivered, and deleting immediately keeps the on-disk
     * queue as small as possible on a storage-constrained phone.
     */
    @Query("DELETE FROM packets WHERE packetId IN (:packetIds)")
    suspend fun markSent(packetIds: List<String>)

    /**
     * Flags a packet the server refused, keeping the row and the server's [reason].
     *
     * Deliberately not a delete: a rejected packet will be rejected identically on every retry, so
     * it must leave the PENDING set -- but erasing it would also erase the only local evidence
     * that packets are being dropped. Rejected rows are never re-uploaded (every read query above
     * filters on `'PENDING'`), are counted for the pilot, and are removed later by [trimRejected].
     */
    @Query("UPDATE packets SET status = 'REJECTED', rejectionReason = :reason WHERE packetId = :packetId")
    suspend fun markRejected(packetId: String, reason: String)

    @Query("SELECT COUNT(*) FROM packets WHERE status = 'REJECTED'")
    suspend fun countRejected(): Int

    /** Observable rejected count for the main screen's live status display. */
    @Query("SELECT COUNT(*) FROM packets WHERE status = 'REJECTED'")
    fun observeRejectedCount(): Flow<Int>

    /** The reason attached to the most recently captured rejected packet, for the status screen. */
    @Query(
        """
        SELECT rejectionReason FROM packets
        WHERE status = 'REJECTED' AND rejectionReason IS NOT NULL
        ORDER BY capturedAtEpochMillis DESC LIMIT 1
        """
    )
    suspend fun latestRejectionReason(): String?

    /** Age-based trim for rejected rows, on the same cutoff as pending ones: they exist to be
     * noticed, not to accumulate forever on a storage-constrained phone. */
    @Query("DELETE FROM packets WHERE status = 'REJECTED' AND capturedAtEpochMillis < :cutoffEpochMillis")
    suspend fun trimRejected(cutoffEpochMillis: Long)

    /** Age-based trim: see [com.rsa.telemetry.queue.QueuePolicy] for the 24h rationale. */
    @Query("DELETE FROM packets WHERE status = 'PENDING' AND capturedAtEpochMillis < :cutoffEpochMillis")
    suspend fun trimExpired(cutoffEpochMillis: Long)

    /** Row-count trim: keeps only the newest [maxRows] pending rows, oldest-first eviction. See
     * [com.rsa.telemetry.queue.QueuePolicy] for the bound rationale. */
    @Query(
        """
        DELETE FROM packets WHERE status = 'PENDING' AND packetId NOT IN (
            SELECT packetId FROM packets WHERE status = 'PENDING' ORDER BY capturedAtEpochMillis DESC LIMIT :maxRows
        )
        """
    )
    suspend fun trimExcess(maxRows: Int)
}
