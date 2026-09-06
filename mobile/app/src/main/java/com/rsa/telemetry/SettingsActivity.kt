package com.rsa.telemetry

import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.rsa.telemetry.databinding.ActivitySettingsBinding

/**
 * Lets the operator enter, once before flying, the three values every packet upload needs:
 * device id (must match a device already registered on the backend), API key, and the server's
 * base URL. Persisted via [com.rsa.telemetry.data.SettingsRepository].
 */
class SettingsActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySettingsBinding
    private val settingsRepository get() = (application as MobileApp).container.settingsRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.deviceIdInput.setText(settingsRepository.deviceId)
        binding.apiKeyInput.setText(settingsRepository.apiKey)
        binding.serverUrlInput.setText(settingsRepository.serverBaseUrl)

        binding.saveButton.setOnClickListener { onSaveClicked() }
    }

    private fun onSaveClicked() {
        val deviceId = binding.deviceIdInput.text?.toString()?.trim().orEmpty()
        val apiKey = binding.apiKeyInput.text?.toString()?.trim().orEmpty()
        val serverUrl = binding.serverUrlInput.text?.toString()?.trim().orEmpty()

        binding.deviceIdLayout.error = null
        binding.apiKeyLayout.error = null
        binding.serverUrlLayout.error = null

        var hasError = false
        if (deviceId.isEmpty()) {
            binding.deviceIdLayout.error = getString(R.string.error_field_required)
            hasError = true
        }
        if (apiKey.isEmpty()) {
            binding.apiKeyLayout.error = getString(R.string.error_field_required)
            hasError = true
        }
        if (serverUrl.isEmpty()) {
            binding.serverUrlLayout.error = getString(R.string.error_field_required)
            hasError = true
        } else if (!serverUrl.startsWith("https://")) {
            binding.serverUrlLayout.error = getString(R.string.error_url_must_be_https)
            hasError = true
        }
        if (hasError) return

        settingsRepository.deviceId = deviceId
        settingsRepository.apiKey = apiKey
        settingsRepository.serverBaseUrl = serverUrl

        Toast.makeText(this, R.string.settings_saved, Toast.LENGTH_SHORT).show()
        finish()
    }
}
