package com.rsa.telemetry.data

import java.net.URI

/**
 * Decides which server base URL the app actually uses, given what is stored in settings.
 *
 * Two cases fall back to the build's default rather than the stored value:
 *  - nothing stored: a fresh install should work without the operator typing a URL, and
 *  - a URL on the retired Render host: the server moved to Railway, and an updated install must not
 *    keep sending its queue to a host that is being shut down.
 *
 * Any other stored URL is the operator's deliberate choice and is kept as is.
 *
 * Pure, with no Android types, so the rule is unit-testable without SharedPreferences.
 */
object ServerUrlResolver {
    private const val RETIRED_HOST_SUFFIX = ".onrender.com"

    fun resolve(stored: String?, default: String): String {
        val url = stored?.trim().orEmpty()
        if (url.isEmpty() || isRetired(url)) return default
        return url
    }

    private fun isRetired(url: String): Boolean {
        val host = runCatching { URI(url).host }.getOrNull() ?: return false
        return host.lowercase().endsWith(RETIRED_HOST_SUFFIX)
    }
}
