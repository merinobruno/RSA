package com.rsa.telemetry.network

import com.rsa.telemetry.capture.TelemetryPacket
import com.rsa.telemetry.data.SettingsRepository
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * Talks to the backend's `POST /v1/telemetry` endpoint: a bearer-token-authenticated batch POST
 * whose body is a JSON array of packets (see server API contract).
 *
 * Plain OkHttp + kotlinx.serialization rather than Retrofit + Moshi: there is exactly one
 * endpoint, so Retrofit's reflection-free-but-still-proxy-based interface generation has nothing
 * to save us from, and kotlinx.serialization's compiler plugin (like Moshi codegen) avoids
 * runtime reflection entirely -- the combination keeps the method count and APK size down, which
 * matters on the cheap phones this app targets. Base URL and API key are read from
 * [SettingsRepository] on every call rather than cached, since the operator can edit them between
 * flights without reinstalling.
 */
class TelemetryApiClient(
    private val settingsRepository: SettingsRepository,
    private val httpClient: OkHttpClient = defaultHttpClient(),
) {
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun postBatch(packets: List<TelemetryPacket>): UploadHttpResult = withContext(Dispatchers.IO) {
        val baseUrl = settingsRepository.serverBaseUrl
        val apiKey = settingsRepository.apiKey
        if (baseUrl.isBlank() || apiKey.isBlank()) {
            return@withContext UploadHttpResult.NetworkError("Server URL or API key is not configured")
        }

        val body = json.encodeToString(ListSerializer(TelemetryPacket.serializer()), packets)
            .toRequestBody(JSON_MEDIA_TYPE)

        val request = Request.Builder()
            .url("$baseUrl$TELEMETRY_PATH")
            .addHeader("Authorization", "Bearer $apiKey")
            .post(body)
            .build()

        try {
            httpClient.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    UploadHttpResult.Success(parseBody(response.body?.string()))
                } else {
                    UploadHttpResult.HttpError(response.code)
                }
            }
        } catch (e: IOException) {
            UploadHttpResult.NetworkError(e.message ?: e.javaClass.simpleName)
        }
    }

    /**
     * Returns null when the response body is absent or does not parse, which the caller treats as
     * "no evidence of any rejection" (see [RejectionResolver.split]). A malformed body is not
     * grounds to strand data in the queue: the server already committed to the batch with a 2xx.
     */
    private fun parseBody(rawBody: String?): TelemetryBatchResponse? {
        if (rawBody.isNullOrBlank()) return null
        return try {
            json.decodeFromString(TelemetryBatchResponse.serializer(), rawBody)
        } catch (e: SerializationException) {
            null
        } catch (e: IllegalArgumentException) {
            null
        }
    }

    companion object {
        private const val TELEMETRY_PATH = "/v1/telemetry"
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

        fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            // No retry-on-connection-failure at the OkHttp layer: retries are the queue's job
            // (the packet stays PENDING and is picked up by the next capture tick or WorkManager
            // run), so we don't want two independent retry mechanisms racing each other.
            .retryOnConnectionFailure(false)
            .build()
    }
}
