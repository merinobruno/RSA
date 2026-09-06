package com.rsa.telemetry.network

/** Result of one [TelemetryApiClient.postBatch] HTTP attempt. */
sealed class UploadHttpResult {
    /**
     * The server answered 2xx. [body] carries its per-packet verdict, or is null when the body was
     * missing or unparseable -- a 2xx alone does not mean every packet was stored, so callers must
     * consult [body] rather than assume the whole batch landed. See [RejectionResolver].
     */
    data class Success(val body: TelemetryBatchResponse?) : UploadHttpResult()
    data class HttpError(val code: Int) : UploadHttpResult()
    data class NetworkError(val message: String) : UploadHttpResult()
}

/** Result of one [TelemetryUploader.flushPending] call, which may issue several batched HTTP
 * requests. Pure data, no Android dependency, so retry/decision logic that branches on it is
 * unit testable. */
sealed class FlushOutcome {
    /** Nothing was queued; there was no reason to touch the network. */
    data object NothingPending : FlushOutcome()

    /** Skipped: the device has no network right now. Packets are left pending, untouched. */
    data object NoNetwork : FlushOutcome()

    /** A flush was already running (from the capture loop or a WorkManager job); this call was a
     * no-op rather than a duplicate concurrent upload. */
    data object AlreadyInProgress : FlushOutcome()

    /**
     * [sentCount] packets were stored by the server and removed from the local queue.
     *
     * [rejectedCount] packets in those same batches were refused by the server despite the 2xx.
     * They are flagged [com.rsa.telemetry.queue.PacketStatus.REJECTED] locally, never retried, and
     * surfaced to the pilot -- a non-zero value here means tracking is losing data right now.
     */
    data class Sent(val sentCount: Int, val rejectedCount: Int = 0) : FlushOutcome()

    /** The server rejected a batch (e.g. bad auth, malformed payload). The batch is left pending
     * -- the operator may need to fix settings, but we never drop data based on a guess. */
    data class ServerRejected(val httpCode: Int, val sentBeforeFailure: Int) : FlushOutcome()

    /** A network-level error occurred mid-flush (e.g. connection dropped after the connectivity
     * check succeeded). Whatever had already been sent is still marked sent; the rest stays
     * pending for the next attempt. */
    data class NetworkFailure(val reason: String, val sentBeforeFailure: Int) : FlushOutcome()
}
