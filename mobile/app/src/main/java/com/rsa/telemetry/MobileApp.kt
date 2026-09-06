package com.rsa.telemetry

import android.app.Application
import com.rsa.telemetry.work.RetryUploadWorker

class MobileApp : Application() {

    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        // Safety-net catch-up flush: runs periodically and whenever WorkManager's network
        // constraint becomes satisfied, independent of whether the foreground service is alive.
        // Idempotent to enqueue on every process start (KEEP policy inside).
        RetryUploadWorker.schedulePeriodic(this)
    }
}
