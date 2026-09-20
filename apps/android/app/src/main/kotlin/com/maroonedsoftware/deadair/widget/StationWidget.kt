package com.maroonedsoftware.deadair.widget

import android.content.Context
import android.graphics.Bitmap
import android.text.format.DateFormat
import java.util.Date
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.action.clickable
import androidx.glance.action.actionStartActivity
import androidx.glance.ColorFilter
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Spacer
import androidx.glance.layout.size
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.padding
import androidx.glance.material3.ColorProviders
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.maroonedsoftware.deadair.DeadairApp
import com.maroonedsoftware.deadair.MainActivity
import com.maroonedsoftware.deadair.R
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
    /**
     * Two shapes rather than one that squeezes.
     *
     * A home screen's rows are the listener's to divide, and what has to survive the narrow one is
     * the record's name and a way to stop it. The cover and the operator's Skip are what a wider
     * one buys: a cover in a 2-cell row leaves about two words for the title, and a Skip crowded
     * against Stop is the press this app has spent two surfaces keeping apart.
     */
    override val sizeMode = SizeMode.Responsive(setOf(NARROW, WIDE))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val graph = (context.applicationContext as DeadairApp).graph
        // Waits for the snapshot to be read off disk, which on a cold start is why this process
        // exists at all: drawing before then would flash the empty state at somebody whose station
        // has been kept for months. It waits with a deadline, because a Glance composition runs
        // inside a WorkManager job and a suspend that never returns there is an ANR rather than a
        // blank widget — measured, as `No response to onStartJob`.
        val first = withTimeoutOrNull(HYDRATION_WAIT_MS) { graph.widget.current() } ?: WidgetState()
        val keptFirst = withTimeoutOrNull(HYDRATION_WAIT_MS) { graph.settings.settings.first() } ?: ListenerSettings()

        provideContent {
            // COLLECTED here rather than read above, and that is the difference between a widget
            // that follows the station and one that draws the record it was born with. Glance keeps
            // one session per widget: an update to a widget whose session is already open
            // RECOMPOSES it rather than calling `provideGlance` again, so a composition built from
            // values captured up there produces identical output for ever. Measured — the station
            // was stopped and the widget went on showing the record and a Stop button.
            val state by graph.widget.state.collectAsState(initial = first)
            val kept by graph.settings.settings.collectAsState(initial = keptFirst)
            val cover by graph.widget.cover.collectAsState()

            // `hasStation` is whether one has been NAMED, which is not the same as knowing what it
            // calls itself: a station kept but never reached has an address and no name.
            Station(state ?: first, kept, cover)
        }
    }

    @Composable
    private fun Station(state: WidgetState, kept: ListenerSettings, cover: Bitmap?) {
        val context = LocalContext.current
        val wide = LocalSize.current.width >= WIDE.width
        val reading =
            widgetReading(
                // Whether a station has been NAMED, which is not the same as knowing what it calls
                // itself: one kept but never reached has an address and no name.
                hasStation = kept.station != null,
                follows = kept.widgetFollows,
                playback = state.playback,
                snapshot = state.snapshot,
            )
        val heading = reading.heading(context, state.snapshot.stationName)
        val under = reading.under(context)
        val asOf = asOf(kept.widgetFollows, state.playback, state.snapshot, System.currentTimeMillis())

        GlanceTheme(colors = if (kept.dynamicColor && supportsDynamicColor) GlanceTheme.colors else STATION_COLORS) {
            Row(
                modifier =
                    GlanceModifier
                        .fillMaxSize()
                        // Both, and neither is decoration: `appWidgetBackground` is what lets the
                        // launcher round the widget's corners to match everything else on the
                        // screen, and the radius is what a launcher too old to do that falls back on.
                        .appWidgetBackground()
                        .cornerRadius(16.dp)
                        .background(GlanceTheme.colors.widgetBackground)
                        .padding(start = 14.dp, end = 8.dp, top = 12.dp, bottom = 12.dp)
                        // Everything but the button, rather than a target of its own: a home screen
                        // is pressed with a thumb, and all of this says "the station" anyway.
                        .clickable(actionStartActivity<MainActivity>()),
                verticalAlignment = Alignment.Vertical.CenterVertically,
            ) {
                // Only over something that is on: off air the square would be the last record's
                // cover under the words "Off air", which is a picture telling a lie.
                if (wide && cover != null && reading is WidgetReading.Record) Cover(cover)
                Column(modifier = GlanceModifier.defaultWeight()) {
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
                    if (asOf != null) AsOf(asOf, context)
                }
                // Drawn before Play, because Play is where a thumb goes by habit and Skip is the
                // one that cuts everybody's record.
                if (wide && offersSkip(state.operator, reading)) Skip(state.skipArmed, context)
                // Nothing to press with no station kept: the app is where one is named, and the
                // tap that opens it is already the whole widget.
                if (reading != WidgetReading.NoStation) PlayStop(state.playback, context)
            }
        }
    }

    /**
     * The cover of what is playing.
     *
     * A bitmap rather than a URL, because the launcher inflates this in its own process and cannot
     * fetch anything: what crosses is pixels. `Cover.kt` is where they are sized, and why.
     */
    @Composable
    private fun Cover(cover: Bitmap) {
        Image(
            provider = ImageProvider(cover),
            // Decoration: the record's title is beside it, in words a screen reader can read.
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = GlanceModifier.size(48.dp).cornerRadius(6.dp).padding(end = 0.dp),
        )
        Spacer(GlanceModifier.size(12.dp))
    }

    /**
     * When this reading was taken, and a way to ask again.
     *
     * Drawn only when the widget is following the station with nothing playing here and the answer
     * has gone stale, which is the one case where what is on screen might not be what is on air.
     * The time is formatted by the platform, so it follows the phone's own twelve- or twenty-four
     * hour setting exactly as `ClockLabel` does inside the app.
     */
    @Composable
    private fun AsOf(readAtMs: Long, context: Context) {
        Text(
            text = context.getString(R.string.widget_as_of, DateFormat.getTimeFormat(context).format(Date(readAtMs))),
            maxLines = 1,
            style = TextStyle(color = GlanceTheme.colors.outline, fontSize = 11.sp),
            modifier = GlanceModifier.clickable(actionRunCallback<RefreshAction>()),
        )
    }

    /**
     * The operator's Skip, which arms before it fires.
     *
     * Armed it is drawn in the error colour and says so to a screen reader, because a button that
     * has quietly changed what it will do is the one thing this control must not be.
     */
    @Composable
    private fun Skip(armed: Boolean, context: Context) {
        Image(
            provider = ImageProvider(R.drawable.ic_skip_next),
            contentDescription = context.getString(if (armed) R.string.widget_skip_armed else R.string.widget_skip),
            colorFilter = ColorFilter.tint(if (armed) GlanceTheme.colors.error else GlanceTheme.colors.onSurfaceVariant),
            modifier = GlanceModifier.size(48.dp).padding(12.dp).clickable(actionRunCallback<SkipAction>()),
        )
    }

    /**
     * Play, or Stop while anything has been asked for.
     *
     * Read from the playback state rather than from what is on air, exactly as the tile and the
     * app's own button are: the listener asked for the station, and every surface says so at once
     * rather than when the first audio arrives.
     */
    @Composable
    private fun PlayStop(playback: WidgetPlayback, context: Context) {
        val stopping = playback != WidgetPlayback.STOPPED
        Image(
            provider = ImageProvider(if (stopping) R.drawable.ic_stop else R.drawable.ic_play),
            contentDescription = context.getString(if (stopping) R.string.stop_listening else R.string.play),
            colorFilter = ColorFilter.tint(GlanceTheme.colors.primary),
            modifier = GlanceModifier.size(48.dp).padding(10.dp).clickable(actionRunCallback<StationPressAction>()),
        )
    }
}

/** One cell wide and one tall, near enough: the record and a way to stop it, and nothing else. */
private val NARROW = DpSize(140.dp, 48.dp)

/** Three cells: room for the cover and, for the station's own account, Skip. */
private val WIDE = DpSize(250.dp, 48.dp)

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
