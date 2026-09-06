package com.rsa.telemetry

import android.content.Context
import com.rsa.telemetry.data.AppDatabase
import com.rsa.telemetry.data.SettingsRepository
import com.rsa.telemetry.network.ConnectivityChecker
import com.rsa.telemetry.network.TelemetryApiClient
import com.rsa.telemetry.network.TelemetryUploader

/**
 * Hand-rolled dependency container ("poor man's DI"): no Hilt/Koin dependency, just a handful of
 * eagerly-built singletons handed out from [MobileApp]. A DI framework buys little for an app
 * this small and would add its own runtime/APK-size overhead on a phone this app is deliberately
 * trying to be light on.
 */
class AppContainer(context: Context) {
    val settingsRepository = SettingsRepository(context)
    val database: AppDatabase = AppDatabase.getInstance(context)
    val connectivityChecker = ConnectivityChecker(context)
    val apiClient = TelemetryApiClient(settingsRepository)
    val uploader = TelemetryUploader(database.packetDao(), apiClient, connectivityChecker)
}
