package com.rsa.telemetry

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.rsa.telemetry.databinding.ActivityMainBinding
import com.rsa.telemetry.service.TelemetryForegroundService
import com.rsa.telemetry.util.Iso8601
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch

/**
 * Landing screen: start/stop the tracking service and show enough live status (running/stopped,
 * queued packet count, last capture time) that the pilot has some confidence it is working
 * before takeoff, plus entry points for Settings and the battery-optimization exemption request.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val container get() = (application as MobileApp).container

    private val requestLocationPermissions =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
            val fineGranted = grants[Manifest.permission.ACCESS_FINE_LOCATION] == true
            if (fineGranted) {
                requestBackgroundLocationIfNeeded()
            } else {
                Toast.makeText(this, R.string.permission_denied_location, Toast.LENGTH_LONG).show()
            }
        }

    private val requestBackgroundLocation =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (!granted) {
                // Not fatal: proceed anyway. A foreground service with the "location" type is
                // itself treated as foreground for location access on most OS versions, and we'd
                // rather capture with degraded guarantees than not start at all -- the operator
                // was already told via the toast below.
                Toast.makeText(this, R.string.permission_denied_location, Toast.LENGTH_LONG).show()
            }
            requestNotificationPermissionIfNeeded()
        }

    private val requestNotificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (!granted) {
                Toast.makeText(this, R.string.permission_denied_notifications, Toast.LENGTH_LONG).show()
            }
            actuallyStartService()
        }

    private val requestBatteryExemptionLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
            refreshBatteryExemptionButton()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.startStopButton.setOnClickListener { onStartStopClicked() }
        binding.settingsButton.setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }
        binding.batteryExemptionButton.setOnClickListener { requestBatteryExemption() }
    }

    override fun onResume() {
        super.onResume()
        binding.notConfiguredWarning.visibility =
            if (container.settingsRepository.isConfigured()) View.GONE else View.VISIBLE
        refreshBatteryExemptionButton()
        refreshRunningStatus()
    }

    override fun onStart() {
        super.onStart()
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch { pollRunningStatus() }
                launch {
                    container.database.packetDao().observePendingCount().collect { count ->
                        binding.pendingCountText.text = getString(R.string.status_pending_packets, count)
                    }
                }
                launch { observeRejections() }
            }
        }
    }

    /**
     * Shows how many packets the server refused, and why.
     *
     * Hidden entirely while the count is zero: a healthy flight should not carry a permanent
     * scary-looking row, and precisely because of that, its appearance means something. A rejected
     * packet is flight data that is gone for good -- retrying would only be refused again -- so
     * this is the pilot's only chance to notice tracking is broken while still on the ground.
     */
    private suspend fun observeRejections() {
        val dao = container.database.packetDao()
        dao.observeRejectedCount().collect { count ->
            if (count == 0) {
                binding.rejectedCountText.visibility = View.GONE
                return@collect
            }
            val reason = dao.latestRejectionReason() ?: getString(R.string.status_rejected_reason_unknown)
            binding.rejectedCountText.text = getString(R.string.status_rejected_format, count, reason)
            binding.rejectedCountText.visibility = View.VISIBLE
        }
    }

    /** [TelemetryForegroundService.isRunning] and [TelemetryForegroundService.lastCaptureEpochMillis]
     * are plain volatile fields, not something observable as a Flow, so this polls them at a
     * human-perceptible rate while the screen is visible -- cheap enough for that. */
    private suspend fun pollRunningStatus() {
        while (true) {
            refreshRunningStatus()
            delay(1_000)
        }
    }

    private fun refreshRunningStatus() {
        val running = TelemetryForegroundService.isRunning
        binding.statusValueText.text = getString(if (running) R.string.status_running else R.string.status_stopped)
        binding.startStopButton.text = getString(if (running) R.string.button_stop else R.string.button_start)
        val lastCapture = TelemetryForegroundService.lastCaptureEpochMillis
        binding.lastCaptureText.text = if (lastCapture == 0L) {
            getString(R.string.status_last_capture_none)
        } else {
            getString(R.string.status_last_capture_format, Iso8601.formatUtc(lastCapture))
        }
    }

    private fun refreshBatteryExemptionButton() {
        val powerManager = getSystemService(PowerManager::class.java)
        val exempted = powerManager.isIgnoringBatteryOptimizations(packageName)
        binding.batteryExemptionButton.isEnabled = !exempted
        binding.batteryExemptionButton.text = getString(
            if (exempted) R.string.battery_exemption_already_granted else R.string.button_request_battery_exemption,
        )
    }

    private fun requestBatteryExemption() {
        val powerManager = getSystemService(PowerManager::class.java)
        if (powerManager.isIgnoringBatteryOptimizations(packageName)) {
            Toast.makeText(this, R.string.battery_exemption_already_granted, Toast.LENGTH_SHORT).show()
            return
        }
        val intent = Intent(
            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:$packageName"),
        )
        requestBatteryExemptionLauncher.launch(intent)
    }

    private fun onStartStopClicked() {
        if (TelemetryForegroundService.isRunning) {
            TelemetryForegroundService.stop(this)
            refreshRunningStatus()
            return
        }
        if (!container.settingsRepository.isConfigured()) {
            Toast.makeText(this, R.string.status_not_configured, Toast.LENGTH_LONG).show()
            return
        }
        requestLocationPermissionsThenStart()
    }

    private fun requestLocationPermissionsThenStart() {
        val fineGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        if (!fineGranted) {
            requestLocationPermissions.launch(
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
            )
            return
        }
        requestBackgroundLocationIfNeeded()
    }

    private fun requestBackgroundLocationIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) ==
                PackageManager.PERMISSION_GRANTED
            if (!granted) {
                requestBackgroundLocation.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                return
            }
        }
        requestNotificationPermissionIfNeeded()
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
            if (!granted) {
                requestNotificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                return
            }
        }
        actuallyStartService()
    }

    private fun actuallyStartService() {
        TelemetryForegroundService.start(this)
        refreshRunningStatus()
    }
}
