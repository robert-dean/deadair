package com.maroonedsoftware.deadair.widget

import android.content.Context
import com.maroonedsoftware.deadair.R

/**
 * The widget's two lines, in the phone's own language.
 *
 * `Message.resolve()` cannot be reused here: it is a Compose UI composable (`stringResource`), and
 * a Glance composition is not a Compose UI one — what it emits is `RemoteViews`. So the widget's
 * reading is resolved the other way the app already does it, with a `Context` and an exhaustive
 * `when`, which keeps the property that matters: a state without a string is a compile error rather
 * than an English fallback, and every sentence still lives in `strings.xml`.
 *
 * [WidgetReading.Record] and [WidgetReading.Break] carry words the STATION sent, which are passed
 * through untranslated exactly as `Message.Text` is.
 */
fun WidgetReading.heading(context: Context, stationName: String?): String {
    val station = stationName ?: context.getString(R.string.app_name)
    return when (this) {
        WidgetReading.NoStation -> context.getString(R.string.app_name)
        WidgetReading.Resting, WidgetReading.WarmingUp, WidgetReading.Unreachable, WidgetReading.OffAir -> station
        is WidgetReading.Record -> title
        is WidgetReading.Break ->
            if (host == null) {
                context.getString(R.string.now_on_the_mic_unnamed)
            } else {
                context.getString(R.string.now_on_the_mic, host)
            }
    }
}

/** The line under the heading, or nothing where the heading says it all. */
fun WidgetReading.under(context: Context): String? =
    when (this) {
        WidgetReading.NoStation -> context.getString(R.string.widget_choose_station)
        WidgetReading.Resting -> context.getString(R.string.widget_resting)
        WidgetReading.WarmingUp -> context.getString(R.string.now_warming_up)
        WidgetReading.Unreachable -> context.getString(R.string.now_cant_reach)
        WidgetReading.OffAir -> context.getString(R.string.now_off_air)
        is WidgetReading.Record -> artist
        is WidgetReading.Break -> label
    }
