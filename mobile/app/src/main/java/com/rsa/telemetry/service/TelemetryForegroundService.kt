package com.rsa.telemetry.service

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.rsa.telemetry.MobileApp
import com.rsa.telemetry.R
import com.rsa.telemetry.capture.AccelerationSensorReader
import com.rsa.telemetry.capture.BatteryReader
import com.rsa.telemetry.capture.LocationProvider
import com.rsa.telemetry.capture.PacketFactory
import com.rsa.telemetry.capture.TelemetryReading
import com.rsa.telemetry.data.PacketDao
import com.rsa.telemetry.data.toEntity
import com.rsa.telemetry.queue.QueuePolicy
import com.rsa.telemetry.util.Iso8601
import com.rsa.telemetry.work.RetryUploadWorker
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Foreground service that owns the capture loop: every 30 seconds, while running, it takes one
 * location + acceleration + battery reading, queues it, and triggers an upload attempt. Runs with
 * a persistent notification (required by the platform for any long-lived background work) and
 * declares the `location` foreground service type mandated on API 34+.
 *
 * Started explicitly by the user from [com.rsa.telemetry.MainActivity]; never auto-starts itself,
 * so a grounded aircraft never has the app quietly draining its battery.
 */
class TelemetryForegroundService : LifecycleService() {

    private lateinit var locationProvider: LocationProvider
    private lateinit var accelReader: AccelerationSensorReader
    private lateinit var connectivityManager: ConnectivityManager

    private var captureJob: Job? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    private val container get() = (application as MobileApp).container

    override fun onCreate() {
        super.onCreate()
        locationProvider = LocationProvider(this)
        accelReader = AccelerationSensorReader(this)
        accelReader.start()

        NotificationHelper.ensureChannel(this)
        startForegroundCompat(NotificationHelper.buildNotification(this, getString(R.string.notification_text_initial)))

        registerNetworkCallback()
        isRunning = true
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        if (captureJob?.isActive != true) {
            captureJob = lifecycleScope.launch {
                while (isActive) {
                    // The cycle's own cost (GPS fix + upload) is subtracted from the pause, so the
                    // capture cadence stays at the interval instead of drifting by however slow the
                    // device and network are. See QueuePolicy.nextDelayMillis.
                    val startedAt = System.currentTimeMillis()
                    runCaptureTick()
                    delay(QueuePolicy.nextDelayMillis(System.currentTimeMillis() - startedAt))
                }
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        captureJob?.cancel()
        accelReader.stop()
        networkCallback?.let { connectivityManager.unregisterNetworkCallback(it) }
        isRunning = false
        super.onDestroy()
    }

    private fun startForegroundCompat(notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NotificationHelper.NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(NotificationHelper.NOTIFICATION_ID, notification)
        }
    }

    private fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private suspend fun runCaptureTick() {
        if (!hasLocationPermission()) {
            updateNotification(getString(R.string.notification_text_no_permission))
            return
        }

        val location = locationProvider.getCurrentLocation()
        if (location == null) {
            // No GPS fix yet (cold start, indoors, etc). Skip this cycle rather than record
            // meaningless zeroed coordinates -- a gap in the track is honest, a fake point isn't.
            updateNotification(getString(R.string.notification_text_waiting_gps))
            return
        }

        val accel = accelReader.currentReading()
        val reading = TelemetryReading(
            capturedAtEpochMillis = System.currentTimeMillis(),
            lat = location.latitude,
            lon = location.longitude,
            altitudeM = if (location.hasAltitude()) location.altitude else 0.0,
            gpsAccuracyM = if (location.hasAccuracy()) location.accuracy else 0f,
            speedMps = if (location.hasSpeed()) location.speed else 0f,
            headingDeg = if (location.hasBearing()) location.bearing else 0f,
            accelX = accel.getOrElse(0) { 0f },
            accelY = accel.getOrElse(1) { 0f },
            accelZ = accel.getOrElse(2) { 0f },
            batteryPct = BatteryReader.currentBatteryPercent(this),
        )

        val packet = PacketFactory.createPacket(reading, deviceId = container.settingsRepository.deviceId)
        lastPacket = packet
        val dao = container.database.packetDao()
        dao.insert(packet.toEntity(reading.capturedAtEpochMillis))

        val trimCutoff = reading.capturedAtEpochMillis - QueuePolicy.MAX_PENDING_AGE_MILLIS
        dao.trimExpired(cutoffEpochMillis = trimCutoff)
        dao.trimExcess(QueuePolicy.MAX_PENDING_ROWS)
        dao.trimRejected(cutoffEpochMillis = trimCutoff)

        lastCaptureEpochMillis = reading.capturedAtEpochMillis
        refreshNotification(reading.capturedAtEpochMillis, dao)

        // Trigger (a) of the upload contract: "a capture cycle just added one".
        container.uploader.flushPending()

        // Refresh again after the flush: it may have just learned that the server is refusing
        // packets, and the pilot should see that now rather than a capture interval later.
        refreshNotification(reading.capturedAtEpochMillis, dao)
    }

    /**
     * The rejected count is shown only once it is non-zero, so the normal notification stays quiet,
     * and a flight that is losing data never looks identical to a healthy one.
     */
    private suspend fun refreshNotification(capturedAtEpochMillis: Long, dao: PacketDao) {
        val pendingCount = dao.countPending()
        val rejectedCount = dao.countRejected()
        val capturedAt = Iso8601.formatUtc(capturedAtEpochMillis)
        updateNotification(
            if (rejectedCount > 0) {
                getString(R.string.notification_text_format_rejected, capturedAt, pendingCount, rejectedCount)
            } else {
                getString(R.string.notification_text_format, capturedAt, pendingCount)
            },
        )
    }

    private fun updateNotification(statusText: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NotificationHelper.NOTIFICATION_ID, NotificationHelper.buildNotification(this, statusText))
    }

    private fun registerNetworkCallback() {
        connectivityManager = getSystemService(ConnectivityManager::class.java)
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                // Trigger (b) of the upload contract: "on connectivity regained", to catch up
                // right away instead of waiting for the next scheduled capture tick.
                lifecycleScope.launch { container.uploader.flushPending() }
                RetryUploadWorker.triggerOneTime(applicationContext)
            }
        }
        connectivityManager.registerDefaultNetworkCallback(callback)
        networkCallback = callback
    }

    companion object {
        @Volatile
        var isRunning: Boolean = false
            private set

        /**
         * The last packet built, exposed so the main screen can show exactly what is being sent.
         *
         * Held here rather than read back from the queue because a delivered packet is deleted
         * from the queue immediately, so after a healthy upload there would be nothing left to
         * display - and the one moment the operator most wants to see the data is when everything
         * is working. Same volatile-field approach as [lastCaptureEpochMillis].
         */
        @Volatile
        var lastPacket: com.rsa.telemetry.capture.TelemetryPacket? = null
            private set

        /** Wall-clock time of the last successful capture, for [com.rsa.telemetry.MainActivity]'s
         * status display. In-process only (both run in the same process, so a plain volatile is
         * enough -- no need to round-trip through Room or SharedPreferences for this). Zero
         * means "no capture yet this run". */
        @Volatile
        var lastCaptureEpochMillis: Long = 0L
            private set

        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, TelemetryForegroundService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, TelemetryForegroundService::class.java))
        }
    }
}
