package com.rsa.telemetry.network

import com.rsa.telemetry.data.SettingsRepository
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Reads the program version the server reports at `GET /version`. Unauthenticated, so it works
 * before the operator has entered a device id or API key.
 *
 * Returns null on any failure -- no network, a non-2xx, an unparseable body. The caller shows that
 * as "could not check" and never as a verdict: a phone with no signal is not a phone that needs
 * updating.
 */
class VersionClient(
    private val settingsRepository: SettingsRepository,
    private val httpClient: OkHttpClient = defaultHttpClient(),
) {
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun fetchServerVersion(): String? = withContext(Dispatchers.IO) {
        val baseUrl = settingsRepository.serverBaseUrl
        if (baseUrl.isBlank()) return@withContext null

        val request = try {
            Request.Builder().url("$baseUrl$VERSION_PATH").get().build()
        } catch (e: IllegalArgumentException) {
            return@withContext null // not a valid URL
        }

        try {
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@use null
                val body = response.body?.string() ?: return@use null
                runCatching { json.decodeFromString(VersionResponse.serializer(), body).version }.getOrNull()
            }
        } catch (e: IOException) {
            null
        }
    }

    @Serializable
    private data class VersionResponse(val version: String)

    private companion object {
        const val VERSION_PATH = "/version"

        // Short: this runs every time the main screen opens, and a slow answer is worth less than
        // a quick "could not check".
        fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(8, TimeUnit.SECONDS)
            .build()
    }
}
