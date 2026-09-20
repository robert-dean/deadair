package com.maroonedsoftware.deadair.widget

import android.content.Context
import androidx.glance.GlanceId
import androidx.glance.action.ActionParameters
import androidx.glance.appwidget.action.ActionCallback
import com.maroonedsoftware.deadair.DeadairApp

/**
 * The operator's Skip, from the home screen.
 *
 * It only tells the feed a press happened: whether that arms the button or cuts the record is the
 * feed's to decide, because the window it is decided against has to outlive this broadcast — which
 * ends the moment this function returns.
 */
class SkipAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        (context.applicationContext as DeadairApp).graph.widget.onSkipPressed()
    }
}
