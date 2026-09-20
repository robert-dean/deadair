package com.maroonedsoftware.deadair.widget

import android.content.Context
import androidx.glance.GlanceId
import androidx.glance.action.ActionParameters
import androidx.glance.appwidget.action.ActionCallback
import com.maroonedsoftware.deadair.DeadairApp
import com.maroonedsoftware.deadair.playback.pressStation

/**
 * The widget's Play/Stop.
 *
 * It calls the same `pressStation` the Quick Settings tile does, so a press here is the same
 * `play()` the app's own button sends and reaches the same session. Nothing about the state is
 * decided here: what the widget last DREW can be a minute old, and the press is worked out afresh
 * from the kept station and the bound player.
 *
 * This runs on a broadcast, whose lifetime ends when this function returns — which is why the work
 * is handed to the process-lifetime scope inside `pressStation` rather than done here.
 */
class StationPressAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        pressStation(context.applicationContext, (context.applicationContext as DeadairApp).graph.settings)
    }
}
