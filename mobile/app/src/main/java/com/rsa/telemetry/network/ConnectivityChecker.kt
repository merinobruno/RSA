package com.rsa.telemetry.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities

/** Answers "does the device currently believe it has usable internet?" -- a cheap, synchronous
 * check done before ever attempting an upload, so a doomed HTTP call is never even started while
 * flying over rural terrain with no signal. */
class ConnectivityChecker(context: Context) {
    private val connectivityManager =
        context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    fun isOnline(): Boolean {
        val network = connectivityManager.activeNetwork ?: return false
        val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }
}
