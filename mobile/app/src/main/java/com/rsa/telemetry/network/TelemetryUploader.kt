package com.rsa.telemetry.network

import com.rsa.telemetry.data.PacketDao
import com.rsa.telemetry.data.toPacket
import com.rsa.telemetry.queue.QueuePolicy
import kotlinx.coroutines.sync.Mutex

/**
 * Flushes whatever is pending in the local queue to the backend, in bounded batches.
 *
 * Called from two independent triggers, both funneling through the same [flushMutex] so they
 * never run concurrently against the same rows: [com.rsa.telemetry.service.TelemetryForegroundService]
 * calls this right after every capture-and-insert, and [com.rsa.telemetry.work.RetryUploadWorker]
 * calls it periodically and whenever connectivity is regained, to catch up after an outage. Even
 * if both somehow overlapped, the server dedupes by `packet_id`, so a duplicate send is wasted
 * bandwidth at worst, never a correctness problem -- the mutex is an efficiency measure, not a
 * safety net.
 */
class TelemetryUploader(
    private val dao: PacketDao,
    private val apiClient: TelemetryApiClient,
    private val connectivityChecker: ConnectivityChecker,
) {
    private val flushMutex = Mutex()

    suspend fun flushPending(): FlushOutcome {
        if (!flushMutex.tryLock()) return FlushOutcome.AlreadyInProgress
        try {
            return flushLoop()
        } finally {
            flushMutex.unlock()
        }
    }

    private suspend fun flushLoop(): FlushOutcome {
        var totalSent = 0
        var totalRejected = 0

        /** A flush that rejected packets but sent none is still news, not "nothing happened". */
        fun progressOutcome(): FlushOutcome? =
            if (totalSent > 0 || totalRejected > 0) FlushOutcome.Sent(totalSent, totalRejected) else null

        while (true) {
            val pendingCount = dao.countPending()
            if (!QueuePolicy.shouldAttemptUpload(pendingCount, connectivityChecker.isOnline())) {
                return progressOutcome()
                    ?: (if (pendingCount == 0) FlushOutcome.NothingPending else FlushOutcome.NoNetwork)
            }

            val batch = dao.fetchPending(limit = QueuePolicy.UPLOAD_BATCH_SIZE)
            if (batch.isEmpty()) {
                return progressOutcome() ?: FlushOutcome.NothingPending
            }

            when (val result = apiClient.postBatch(batch.map { it.toPacket() })) {
                is UploadHttpResult.Success -> {
                    // A 2xx is not a blanket receipt: the server validates each packet on its own
                    // and names the ones it refused. Deleting a refused packet would hide the loss
                    // behind a healthy-looking screen, so only what the server actually stored is
                    // removed here -- the rest is flagged and counted.
                    val split = RejectionResolver.split(batch.map { it.packetId }, result.body)
                    if (split.deliveredIds.isNotEmpty()) dao.markSent(split.deliveredIds)
                    split.rejected.forEach { dao.markRejected(it.packetId, it.reason) }

                    totalSent += split.deliveredIds.size
                    totalRejected += split.rejected.size + split.unresolvedRejections

                    // Every row in this batch was either deleted or flagged REJECTED, so it has
                    // left the PENDING set: the loop always makes progress and cannot spin on the
                    // same rows. Loop again -- a long outage leaves more than one batch queued.
                }
                is UploadHttpResult.HttpError -> {
                    return FlushOutcome.ServerRejected(result.code, totalSent)
                }
                is UploadHttpResult.NetworkError -> {
                    return FlushOutcome.NetworkFailure(result.message, totalSent)
                }
            }
        }
    }
}
