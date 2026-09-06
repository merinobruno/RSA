package com.rsa.telemetry.capture

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Thin wrapper over [FusedLocationProviderClient]. All packet geo fields (lat/lon/altitude/
 * accuracy/speed/heading) come from the [Location] object this returns -- none of them are
 * computed by hand, per the server contract.
 *
 * Caller is responsible for having ACCESS_FINE_LOCATION (and ACCESS_BACKGROUND_LOCATION for
 * screen-off capture) granted before calling; that is enforced in MainActivity/the foreground
 * service before this class is ever touched, hence the lint suppression below rather than a
 * runtime check here.
 */
class LocationProvider(context: Context) {
    private val client: FusedLocationProviderClient =
        LocationServices.getFusedLocationProviderClient(context.applicationContext)

    @SuppressLint("MissingPermission")
    suspend fun getCurrentLocation(): Location? = suspendCancellableCoroutine { continuation ->
        val cancellationSource = CancellationTokenSource()
        val request = CurrentLocationRequest.Builder()
            .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
            .setMaxUpdateAgeMillis(0)
            .setDurationMillis(FIX_TIMEOUT_MILLIS)
            .build()

        client.getCurrentLocation(request, cancellationSource.token)
            .addOnSuccessListener { location -> continuation.resume(location) }
            .addOnFailureListener { continuation.resume(null) }
            .addOnCanceledListener { continuation.resume(null) }

        continuation.invokeOnCancellation { cancellationSource.cancel() }
    }

    private companion object {
        /**
         * Upper bound on a single fix attempt.
         *
         * Without it the request waits indefinitely, and because the capture loop awaits this call,
         * a device that cannot see satellites (indoors, in a hangar, under a wing) stalls the whole
         * cycle: nothing captured, nothing queued, nothing uploaded, and the notification frozen on
         * the previous capture. Measured in the field before this bound existed: one indoor request
         * held the loop for 339 seconds against a 30-second capture interval.
         *
         * Half the capture interval, so a failed attempt still leaves the next cycle roughly on
         * schedule. Timing out yields a null location, which the caller already treats as "no fix
         * this cycle" -- an honest gap in the track rather than a fabricated point.
         */
        const val FIX_TIMEOUT_MILLIS: Long = 15_000L
    }
}
