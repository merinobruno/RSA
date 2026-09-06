package com.rsa.telemetry.data

import android.content.Context
import androidx.core.content.edit

/**
 * Operator-configured settings: device id, API key and server base URL, entered once in
 * [com.rsa.telemetry.SettingsActivity] before a flight.
 *
 * Plain [android.content.SharedPreferences] rather than DataStore: reads here are synchronous,
 * infrequent (once per capture cycle at most, to build the request) and need no observable
 * Flow -- DataStore's async/Flow machinery would add coroutine dispatch overhead for no benefit
 * on a low-end phone. SharedPreferences with `commit()`-free `apply()` writes is the simpler,
 * cheaper fit here.
 */
class SettingsRepository(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    var deviceId: String
        get() = prefs.getString(KEY_DEVICE_ID, "") ?: ""
        set(value) = prefs.edit { putString(KEY_DEVICE_ID, value.trim()) }

    var apiKey: String
        get() = prefs.getString(KEY_API_KEY, "") ?: ""
        set(value) = prefs.edit { putString(KEY_API_KEY, value.trim()) }

    var serverBaseUrl: String
        get() = prefs.getString(KEY_SERVER_URL, "") ?: ""
        set(value) = prefs.edit { putString(KEY_SERVER_URL, value.trim().trimEnd('/')) }

    fun isConfigured(): Boolean = deviceId.isNotBlank() && apiKey.isNotBlank() && serverBaseUrl.isNotBlank()

    private companion object {
        const val PREFS_NAME = "telemetry_settings"
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_API_KEY = "api_key"
        const val KEY_SERVER_URL = "server_base_url"
    }
}
