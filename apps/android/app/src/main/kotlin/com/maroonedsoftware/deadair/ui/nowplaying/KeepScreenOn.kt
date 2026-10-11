package com.maroonedsoftware.deadair.ui.nowplaying

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LifecycleStartEffect
import com.maroonedsoftware.deadair.nowplaying.KeepAwake
import com.maroonedsoftware.deadair.nowplaying.keepAwake

/**
 * Hold the screen on while [keepAwake] says so, for as long as this is composed.
 *
 * In front means composed AND started: Now playing is composed only while its tab is showing and
 * nothing is pushed over Home, and a stopped activity is one somebody has left. The flag goes on
 * the view rather than through a wake lock, so the window manager drops it the moment the window
 * is not showing, and it is cleared on the way out in case it is not.
 *
 * Charging is read only for [KeepAwake.WHILE_CHARGING], and only while in front: the sticky battery
 * broadcast gives the answer at once, and a receiver for the charger going in and out keeps it,
 * unregistered the moment this stops so nothing listens for a screen that is not up.
 */
@Composable
fun KeepScreenOn(setting: KeepAwake, playing: Boolean) {
    val context = LocalContext.current
    val view = LocalView.current
    var started by remember { mutableStateOf(false) }
    var charging by remember { mutableStateOf(false) }

    LifecycleStartEffect(setting) {
        started = true
        val receiver =
            if (setting == KeepAwake.WHILE_CHARGING) {
                charging = pluggedIn(context)
                object : BroadcastReceiver() {
                    override fun onReceive(context: Context, intent: Intent) {
                        charging = intent.action == Intent.ACTION_POWER_CONNECTED
                    }
                }.also {
                    ContextCompat.registerReceiver(
                        context,
                        it,
                        IntentFilter().apply {
                            addAction(Intent.ACTION_POWER_CONNECTED)
                            addAction(Intent.ACTION_POWER_DISCONNECTED)
                        },
                        ContextCompat.RECEIVER_NOT_EXPORTED,
                    )
                }
            } else {
                null
            }
        onStopOrDispose {
            started = false
            receiver?.let { context.unregisterReceiver(it) }
        }
    }

    val hold = keepAwake(setting, charging = charging, playing = playing, inFront = started)
    DisposableEffect(view, hold) {
        view.keepScreenOn = hold
        onDispose { view.keepScreenOn = false }
    }
}

/** Whether the phone is on power now, from the sticky battery broadcast: no receiver is left behind by asking. */
private fun pluggedIn(context: Context): Boolean {
    val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return false
    return battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
}
