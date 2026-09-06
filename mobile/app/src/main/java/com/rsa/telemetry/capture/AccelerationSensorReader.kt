package com.rsa.telemetry.capture

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager

/**
 * Listens to `TYPE_LINEAR_ACCELERATION` -- deliberately not the raw `TYPE_ACCELEROMETER` -- so
 * gravity is already removed by the platform's sensor fusion, per the server contract. Units are
 * m/s^2, exactly as the sensor reports them.
 *
 * The listener is registered once for the lifetime of the foreground service (via [start]/[stop])
 * rather than per capture tick: re-registering every 30 seconds would cost more (sensor
 * subsystem wakeups) than just keeping a lightweight listener parked at
 * [SensorManager.SENSOR_DELAY_NORMAL] and reading whatever its latest cached value is when a
 * capture tick happens.
 */
class AccelerationSensorReader(context: Context) : SensorEventListener {
    private val sensorManager = context.applicationContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val sensor: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)

    @Volatile
    private var latest: FloatArray = floatArrayOf(0f, 0f, 0f)

    /** True if the device actually exposes a linear-acceleration sensor. Readings default to
     * zero when it does not, rather than crashing a flight-critical capture loop. */
    val isAvailable: Boolean get() = sensor != null

    fun start() {
        sensor?.let { sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL) }
    }

    fun stop() {
        sensorManager.unregisterListener(this)
    }

    fun currentReading(): FloatArray = latest.copyOf()

    override fun onSensorChanged(event: SensorEvent) {
        latest = event.values.copyOf()
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        // No-op: accuracy of a fused linear-acceleration sensor is not part of the packet
        // contract and does not change how we read values.
    }
}
