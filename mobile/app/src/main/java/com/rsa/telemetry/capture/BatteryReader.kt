package com.rsa.telemetry.capture

import android.content.Context
import android.os.BatteryManager

/** Reads the current battery level (0-100) from [BatteryManager], per the server contract. */
object BatteryReader {
    fun currentBatteryPercent(context: Context): Int {
        val batteryManager = context.applicationContext.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val pct = batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        return pct.coerceIn(0, 100)
    }
}
