package com.rsa.telemetry.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Body of a successful `POST /v1/telemetry` response.
 *
 * A 2xx does NOT mean every packet in the batch was stored. The server validates each packet
 * independently and reports the ones it refused in [rejectedPackets]. Treating a whole batch as
 * delivered just because the HTTP call succeeded would silently discard flight data while the
 * pilot's screen still reads "healthy" -- the one failure mode a tracker must never have. A gap
 * someone can see beats a gap nobody knows about.
 *
 * Every field carries a default so a server that adds or omits one can never make the response
 * unparseable; the client also decodes with `ignoreUnknownKeys`.
 */
@Serializable
data class TelemetryBatchResponse(
    val received: Int = 0,
    val accepted: Int = 0,
    val inserted: Int = 0,
    val duplicates: Int = 0,
    val rejected: Int = 0,
    @SerialName("rejected_packets") val rejectedPackets: List<RejectedPacket> = emptyList(),
)

/**
 * One packet the server refused, with the reason it gave.
 *
 * [packetId] is nullable on purpose: when a packet's own `packet_id` field is what failed
 * validation, the server has no valid id to echo back and omits it. [index] -- the packet's
 * position in the array we posted -- is what identifies the offending row in that case. See
 * [RejectionResolver].
 */
@Serializable
data class RejectedPacket(
    val index: Int = -1,
    @SerialName("packet_id") val packetId: String? = null,
    val reason: String = "",
)
