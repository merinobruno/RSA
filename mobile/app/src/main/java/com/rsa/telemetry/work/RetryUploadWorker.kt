package com.rsa.telemetry.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.rsa.telemetry.MobileApp
import com.rsa.telemetry.network.FlushOutcome
import java.util.concurrent.TimeUnit

/**
 * Backstop for the foreground service's own capture-triggered flushes: WorkManager re-evaluates
 * the [NetworkType.CONNECTED] constraint continuously, so an enqueued request that could not run
 * (no network) fires as soon as connectivity returns -- not just on the next 15-minute tick. That
 * gives us "flush on connectivity regained" even if the foreground service was killed by an OEM
 * battery manager (see README) and never got the chance to register its own network callback.
 *
 * 15 minutes is WorkManager's documented minimum interval for periodic work; there is no way to
 * schedule it more frequently, which is why the foreground service *also* flushes after every
 * capture tick instead of relying on this worker alone for the common case.
 */
class RetryUploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val container = (applicationContext as MobileApp).container
        return when (container.uploader.flushPending()) {
            is FlushOutcome.NoNetwork -> Result.retry()
            is FlushOutcome.NetworkFailure -> Result.retry()
            is FlushOutcome.ServerRejected -> {
                // A rejected batch (e.g. bad API key) will not fix itself by retrying quickly;
                // still return retry() so WorkManager's own backoff eventually tries again after
                // the operator fixes settings, rather than success (which would look like "all
                // clear" in WorkManager's own diagnostics).
                Result.retry()
            }
            is FlushOutcome.Sent, is FlushOutcome.NothingPending, is FlushOutcome.AlreadyInProgress -> Result.success()
        }
    }

    companion object {
        private const val PERIODIC_WORK_NAME = "telemetry_retry_periodic"
        private const val ONE_TIME_WORK_NAME = "telemetry_retry_one_time"
        private val PERIODIC_INTERVAL = 15L to TimeUnit.MINUTES

        private fun networkConstraints() = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        /** Enqueued once from [com.rsa.telemetry.MobileApp.onCreate]; KEEP so relaunching the
         * app (or a process restart) never duplicates the periodic job. */
        fun schedulePeriodic(context: Context) {
            val request = PeriodicWorkRequestBuilder<RetryUploadWorker>(PERIODIC_INTERVAL.first, PERIODIC_INTERVAL.second)
                .setConstraints(networkConstraints())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PERIODIC_WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }

        /** Fired opportunistically by the foreground service's network callback in addition to
         * its own in-process flush, so a flush is still attempted through WorkManager's
         * infrastructure (and its retry/backoff bookkeeping) even if the in-process attempt is
         * currently mid-flight for another reason. REPLACE is safe: only the freshest attempt
         * matters, and the queue itself is what carries state, not the work request. */
        fun triggerOneTime(context: Context) {
            val request = OneTimeWorkRequestBuilder<RetryUploadWorker>()
                .setConstraints(networkConstraints())
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                ONE_TIME_WORK_NAME,
                ExistingWorkPolicy.REPLACE,
                request,
            )
        }
    }
}
