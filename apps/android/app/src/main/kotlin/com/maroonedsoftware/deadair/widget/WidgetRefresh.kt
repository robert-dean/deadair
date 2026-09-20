package com.maroonedsoftware.deadair.widget

import android.content.Context
import androidx.glance.GlanceId
import androidx.glance.action.ActionParameters
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.action.ActionCallback
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.maroonedsoftware.deadair.DeadairApp
import com.maroonedsoftware.deadair.net.HttpClients
import kotlinx.coroutines.flow.first
import java.util.concurrent.TimeUnit

/**
 * The one request the widget makes on its own, and only for somebody who asked for it.
 *
 * Enqueued while [WidgetFollows.STATION] is chosen and cancelled the moment it is not, so the
 * default install schedules nothing at all. It goes through `HttpClients.sdkFor`, which means it
 * carries the app's one User-Agent: HLS listeners are counted per IP and agent, and a second agent
 * from this phone would be a second listener as far as the station could tell. It asks `/nowplaying`
 * and nothing else — never a mount, because connecting to one is what puts an audience-gated
 * station on air.
 */
class WidgetRefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as? DeadairApp ?: return Result.success()

        // The last widget can be removed without this app being told in any way it can act on, so
        // the work checks rather than trusts. Nothing placed means nothing to refresh, ever.
        if (GlanceAppWidgetManager(applicationContext).getGlanceIds(StationWidget::class.java).isEmpty()) {
            cancel(applicationContext)
            return Result.success()
        }

        val kept = app.graph.settings.settings.first()
        if (kept.widgetFollows != WidgetFollows.STATION) {
            cancel(applicationContext)
            return Result.success()
        }
        val station = kept.station ?: return Result.success()

        return runCatching { HttpClients.sdkFor(station).nowplaying.getNowPlaying() }
            .onSuccess { app.graph.widget.onFetched(it) }
            // Retried rather than failed: the next window is half an hour away, and a station that
            // was unreachable for one request is not news worth putting on somebody's home screen.
            .fold(onSuccess = { Result.success() }, onFailure = { Result.retry() })
    }

    companion object {
        private const val NAME = "widget-refresh"

        /** Idempotent: the same unique work, kept if it is already there, so a settings change does not restart the clock. */
        fun enqueue(context: Context) {
            val request =
                PeriodicWorkRequestBuilder<WidgetRefreshWorker>(WIDGET_REFRESH_MINUTES, TimeUnit.MINUTES)
                    .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                    .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(NAME)
        }
    }
}

/**
 * Ask the station now, which is what tapping the widget's "as of" line means.
 *
 * One request, on the press of somebody looking at the widget. It does not touch the periodic work:
 * a listener who wants to know now is not asking for a different schedule.
 */
class RefreshAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val graph = (context.applicationContext as DeadairApp).graph
        val station = graph.settings.settings.first().station ?: return
        runCatching { HttpClients.sdkFor(station).nowplaying.getNowPlaying() }.onSuccess { graph.widget.onFetched(it) }
    }
}
