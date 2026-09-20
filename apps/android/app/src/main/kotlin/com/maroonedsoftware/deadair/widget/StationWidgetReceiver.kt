package com.maroonedsoftware.deadair.widget

import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver

/**
 * What the launcher talks to.
 *
 * A `BroadcastReceiver`, which is the whole of a widget's lifetime: it is woken, it hands over a
 * drawing, and it is gone. Nothing that has to outlive a press can live here — see
 * `playback/StationPress.kt` for where a press is actually carried out.
 */
class StationWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget get() = StationWidget()
}
