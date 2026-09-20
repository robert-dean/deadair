package com.maroonedsoftware.deadair.widget

import android.content.Context
import androidx.compose.runtime.Composable
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.LocalContext
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.action.clickable
import androidx.glance.action.actionStartActivity
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.padding
import androidx.glance.material3.ColorProviders
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.maroonedsoftware.deadair.DeadairApp
import com.maroonedsoftware.deadair.MainActivity
import com.maroonedsoftware.deadair.settings.ListenerSettings
import com.maroonedsoftware.deadair.ui.theme.DarkScheme
import com.maroonedsoftware.deadair.ui.theme.LightScheme
import com.maroonedsoftware.deadair.ui.theme.supportsDynamicColor

/**
 * The station on the home screen.
 *
 * What it draws comes from [WidgetFeed], never from a request of its own: this function runs when
 * the launcher asks, which is whenever Android feels like it, and a station polled on that schedule
 * would be polled by a phone nobody is listening on. Under the resting default it therefore shows
 * the station's name and nothing else until something else in this app has heard from the station.
 *
 * A Glance composition is not a Compose UI one — it emits `RemoteViews` for the launcher's process
 * to inflate — so nothing from `androidx.compose.ui` works inside here beyond `dp` and `sp`, and
 * the words are resolved with a `Context` rather than `stringResource`.
 */
class StationWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val graph = (context.applicationContext as DeadairApp).graph
        // Waits for the snapshot to be read off disk, which on a cold start is why this process
        // exists at all: drawing before then would flash the empty state at somebody whose station
        // has been kept for months. It waits with a deadline, because a Glance composition runs
        // inside a WorkManager job and a suspend that never returns there is an ANR rather than a
        // blank widget — measured, as `No response to onStartJob`.
        val state = withTimeoutOrNull(HYDRATION_WAIT_MS) { graph.widget.current() } ?: WidgetState()
        val kept = withTimeoutOrNull(HYDRATION_WAIT_MS) { graph.settings.settings.first() } ?: ListenerSettings()

        provideContent {
            // `hasStation` is whether one has been NAMED, which is not the same as knowing what it
            // calls itself: a station kept but never reached has an address and no name.
            Station(state, hasStation = kept.station != null, dynamicColor = kept.dynamicColor)
        }
    }

    @Composable
    private fun Station(state: WidgetState, hasStation: Boolean, dynamicColor: Boolean) {
        val context = LocalContext.current
        val reading = widgetReading(hasStation = hasStation, playback = state.playback, snapshot = state.snapshot)
        val heading = reading.heading(context, state.snapshot.stationName)
        val under = reading.under(context)

        GlanceTheme(colors = if (dynamicColor && supportsDynamicColor) GlanceTheme.colors else STATION_COLORS) {
            Column(
                modifier =
                    GlanceModifier
                        .fillMaxSize()
                        // Both, and neither is decoration: `appWidgetBackground` is what lets the
                        // launcher round the widget's corners to match everything else on the
                        // screen, and the radius is what a launcher too old to do that falls back on.
                        .appWidgetBackground()
                        .cornerRadius(16.dp)
                        .background(GlanceTheme.colors.widgetBackground)
                        .padding(horizontal = 14.dp, vertical = 12.dp)
                        // The whole widget, rather than a target inside it: a home screen is
                        // pressed with a thumb, and everything here says "the station" anyway.
                        .clickable(actionStartActivity<MainActivity>()),
                verticalAlignment = Alignment.Vertical.CenterVertically,
            ) {
                Text(
                    text = heading,
                    maxLines = 2,
                    style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 16.sp, fontWeight = FontWeight.Medium),
                )
                if (under != null) {
                    Text(
                        text = under,
                        maxLines = 1,
                        style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 13.sp),
                    )
                }
            }
        }
    }
}

/** The station's own green on carbon, which is the app's theme said in the one type Glance takes. */
private val STATION_COLORS = ColorProviders(light = LightScheme, dark = DarkScheme)

/**
 * How long a drawing waits for this app's own state before drawing what it has.
 *
 * Both reads are off local disk, so this is a deadline rather than a budget: it is not reached on a
 * phone that is working, and on one that is not, a widget saying "Not listening" a second early is
 * better than a job the system kills the app for.
 */
private const val HYDRATION_WAIT_MS = 2_000L
