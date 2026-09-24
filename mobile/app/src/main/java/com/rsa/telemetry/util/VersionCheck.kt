package com.rsa.telemetry.util

/**
 * Compares this app's version with the server's, which is the program's reference version: the
 * dashboard shows the same number, and both come from server/package.json.
 *
 * Compared numerically part by part, never as text: as strings "1.10.0" sorts before "1.9.0".
 */
sealed interface VersionStatus {
    data object UpToDate : VersionStatus

    /** The server runs a newer program than this app: the operator should install the update. */
    data class UpdateRequired(val serverVersion: String) : VersionStatus

    /** This app is newer than the server, e.g. an app built before its server was deployed. */
    data class ServerBehind(val serverVersion: String) : VersionStatus

    /** The server's version could not be read or did not parse. */
    data object Unknown : VersionStatus
}

object VersionCheck {
    fun compare(appVersion: String, serverVersion: String?): VersionStatus {
        val app = parse(appVersion) ?: return VersionStatus.Unknown
        val server = serverVersion?.let(::parse) ?: return VersionStatus.Unknown
        val order = app.zip(server).map { (a, s) -> a.compareTo(s) }.firstOrNull { it != 0 } ?: 0
        return when {
            order < 0 -> VersionStatus.UpdateRequired(serverVersion)
            order > 0 -> VersionStatus.ServerBehind(serverVersion)
            else -> VersionStatus.UpToDate
        }
    }

    /** MAJOR.MINOR.PATCH, all numeric; anything else is treated as unknown rather than guessed at. */
    private fun parse(version: String): List<Int>? {
        val parts = version.trim().split(".")
        if (parts.size != 3) return null
        return parts.map { it.toIntOrNull()?.takeIf { n -> n >= 0 } ?: return null }
    }
}
