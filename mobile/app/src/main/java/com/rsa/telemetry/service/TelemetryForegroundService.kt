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
    private var uploadJob: Job? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    /** Tracks fix availability so the notification can react the moment it changes, rather than
     * waiting for the next upload cycle to tell the pilot the GPS went away. */
    private var hadFix: Boolean? = null

    private val container get() = (application as MobileApp).container

    override fun onCreate() {
        super.onCreate()
        locationProvider = LocationProvider(this)
        accelReader = AccelerationSensorReader(this)
        accelReader.start()
        if (hasLocationPermission()) locationProvider.start()

        NotificationHelper.ensureChannel(this)
        startForegroundCompat(NotificationHelper.buildNotification(this, getString(R.string.notification_text_initial)))

        registerNetworkCallback()
        isRunning = true
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        // Two loops, because capturing and uploading now run at different rates and neither should
        // be able to stall the other. A slow upload used to delay the next capture; it no longer
        // can, which is what lets the capture cadence actually hold at 1 Hz.
        if (captureJob?.isActive != true) {
            captureJob = lifecycleScope.launch {
                while (isActive) {
                    val startedAt = System.currentTimeMillis()
                    runCaptureTick()
                    delay(QueuePolicy.nextDelayMillis(System.currentTimeMillis() - startedAt))
                }
            }
        }
        if (uploadJob?.isActive != true) {
            uploadJob = lifecycleScope.launch {
                while (isActive) {
                    delay(QueuePolicy.UPLOAD_INTERVAL_MILLIS)
                    runUploadCycle()
                }
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        captureJob?.cancel()
        uploadJob?.cancel()
        locationProvider.stop()
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

    /**
     * One capture. Deliberately does no network work and never waits on the receiver: it takes
     * whatever fix is current and returns, which is what keeps 1 Hz achievable on a slow phone.
     */
    private suspend fun runCaptureTick() {
        if (!hasLocationPermission()) {
            updateNotification(getString(R.string.notification_text_no_permission))
            return
        }
        // Idempotent, and self-heals the case where permission was granted after the service
        // started: without it the stream would never begin and every capture would skip forever.
        locationProvider.start()

        val location = locationProvider.latestFix()
        if (location == null) {
            // No fix, or the last one has gone stale. Skip rather than record a position the
            // aircraft has already left -- a gap in the track is honest, a fabricated point is not.
            if (hadFix != false) {
                hadFix = false
                updateNotification(getString(R.string.notification_text_waiting_gps))
            }
            return
        }
        hadFix = true

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
        container.database.packetDao().insert(packet.toEntity(reading.capturedAtEpochMillis))
        lastCaptureEpochMillis = reading.capturedAtEpochMillis
    }

    /**
     * Trims the queue, uploads it, and refreshes the notification.
     *
     * All three moved out of the capture tick when captures went to 1 Hz. Trimming ran three DELETE
     * statements per capture, and the notification was rebuilt just as often - both wasteful sixty
     * times a minute, and both only meaningful on the timescale at which the queue actually
     * changes. The upload moved because it was the slow part: at 10 s on a weak phone it would have
     * stalled ten captures.
     */
    private suspend fun runUploadCycle() {
        val dao = container.database.packetDao()
        val now = System.currentTimeMillis()
        val trimCutoff = now - QueuePolicy.MAX_PENDING_AGE_MILLIS

        dao.trimExpired(cutoffEpochMillis = trimCutoff)
        dao.trimExcess(QueuePolicy.MAX_PENDING_ROWS)
        dao.trimRejected(cutoffEpochMillis = trimCutoff)

        container.uploader.flushPending()

        // After the flush, so a rejection the server just reported reaches the pilot now rather
        // than a cycle later.
        if (lastCaptureEpochMillis != 0L) refreshNotification(lastCaptureEpochMillis, dao)
    }

    /**
     * The rejected count is shown only once it is non-zero, so the normal notification stays quiet,
     * and a flight that is losing data never looks identical to a healthy one.
     */
    private suspend fun refreshNotification(capturedAtEpochMillis: Long, dao: PacketDao) {
        val pendingCount = dao.countPending()
        val rejectedCount = dao.countRejected()
        // The notification is read by a person, so it shows local time. The packet keeps UTC.
        val capturedAt = Iso8601.formatLocal(capturedAtEpochMillis)
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
