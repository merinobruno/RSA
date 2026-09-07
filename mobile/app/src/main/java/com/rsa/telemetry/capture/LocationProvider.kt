package com.rsa.telemetry.capture

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.os.Looper
import android.os.SystemClock
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.rsa.telemetry.queue.QueuePolicy

/**
 * Keeps a continuous stream of fixes running and hands out the most recent one.
 *
 * This replaced a per-cycle `getCurrentLocation()` request, and the change matters for more than
 * speed. A discrete request re-acquires from cold every time, which is expensive on the receiver
 * and unbounded in duration - one indoor request was measured holding the capture loop for 339
 * seconds. A continuous stream keeps the receiver hot, delivers on its own schedule, and lets a
 * capture take whatever fix is current without ever blocking on one.
 *
 * All packet geo fields (lat/lon/altitude/accuracy/speed/heading) come from the [Location] objects
 * this delivers; none are computed by hand.
 *
 * Caller is responsible for holding ACCESS_FINE_LOCATION before [start]; that is enforced in
 * MainActivity and the foreground service, hence the lint suppression rather than a runtime check.
 */
class LocationProvider(context: Context) {

    private val client: FusedLocationProviderClient =
        LocationServices.getFusedLocationProviderClient(context.applicationContext)

    @Volatile
    private var latest: Location? = null

    private var callback: LocationCallback? = null

    @SuppressLint("MissingPermission")
    fun start() {
        if (callback != null) return

        val request = LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY,
            QueuePolicy.CAPTURE_INTERVAL_MILLIS,
        )
            // Accept fixes as fast as the receiver produces them: a fix slightly newer than the
            // capture interval is strictly better than the one before it, and refusing it would
            // only make what we record older.
            .setMinUpdateIntervalMillis(QueuePolicy.CAPTURE_INTERVAL_MILLIS)
            .build()

        val cb = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { latest = it }
            }
        }

        client.requestLocationUpdates(request, cb, Looper.getMainLooper())
        callback = cb
    }

    fun stop() {
        callback?.let { client.removeLocationUpdates(it) }
        callback = null
        latest = null
    }

    /**
     * The most recent fix, or null if there is none or it has gone stale.
     *
     * Age is measured with [SystemClock.elapsedRealtimeNanos], not the fix's wall-clock time: it is
     * monotonic, so a device clock correction mid-flight cannot make a fresh fix look ancient or a
     * stale one look current.
     *
     * The staleness check is the whole point of this method. With a stream the last known position
     * is always sitting there, and reusing it after the receiver stops delivering would invent a
     * point every second at a place the aircraft has already left - a straight line of fabricated
     * data across the gap, which is far worse than the gap.
     */
    fun latestFix(maxAgeMillis: Long = QueuePolicy.MAX_FIX_AGE_MILLIS): Location? {
        val fix = latest ?: return null
        val ageMillis = (SystemClock.elapsedRealtimeNanos() - fix.elapsedRealtimeNanos) / 1_000_000
        return if (ageMillis <= maxAgeMillis) fix else null
    }
}
