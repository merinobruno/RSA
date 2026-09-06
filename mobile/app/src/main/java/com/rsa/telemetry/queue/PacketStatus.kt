package com.rsa.telemetry.queue

/**
 * What a queued packet counts as. Stored on [com.rsa.telemetry.data.PacketEntity.status] as its
 * [name] (Room stores enums best as plain strings/ints; a string column keeps the raw SQLite
 * data human-readable when inspecting the DB file during field debugging).
 */
enum class PacketStatus {
    PENDING,
    SENT,

    /**
     * The server accepted the request (2xx) but refused this specific packet, giving a reason
     * recorded in [com.rsa.telemetry.data.PacketEntity.rejectionReason].
     *
     * Rejected rows are kept rather than deleted, and are never retried: a packet refused for
     * failing validation would be refused identically forever, so retrying is pointless -- but
     * deleting it would erase the only evidence that tracking is silently broken. The row stays
     * until the age trim removes it, and the count is shown to the pilot.
     */
    REJECTED,
}
