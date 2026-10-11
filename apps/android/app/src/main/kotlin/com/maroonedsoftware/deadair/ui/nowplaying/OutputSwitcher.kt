package com.maroonedsoftware.deadair.ui.nowplaying

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.mediarouter.app.SystemOutputSwitcherDialogController
import androidx.mediarouter.media.MediaControlIntent
import androidx.mediarouter.media.MediaRouteSelector
import androidx.mediarouter.media.MediaRouter
import com.maroonedsoftware.deadair.playback.OutputRoute

/**
 * Now playing's output button: what it says under the controls, and what pressing it does.
 *
 * [playingOn] is the Bluetooth device or network speaker the station is coming out of, or `null` for
 * the phone (see `playingOn` in `playback/OutputRoute.kt`).
 */
data class OutputControl(val playingOn: String?, val onChoose: () -> Unit)

/**
 * The route the system is sending this app's media to, kept current for as long as the caller is
 * composed. A callback rather than a read, because the listener can move the sound from the
 * notification shade's switcher while this screen is up.
 *
 * The router is asked to watch the live-audio routes and to DISCOVER nothing: the selected route is
 * all this needs, and active discovery costs battery and wakes the network for no reason.
 */
@Composable
fun rememberOutputRoute(): OutputRoute? {
    val context = LocalContext.current
    var route by remember { mutableStateOf<OutputRoute?>(null) }
    DisposableEffect(context) {
        val router = MediaRouter.getInstance(context)
        val selector = MediaRouteSelector.Builder().addControlCategory(MediaControlIntent.CATEGORY_LIVE_AUDIO).build()
        val callback =
            object : MediaRouter.Callback() {
                override fun onRouteSelected(router: MediaRouter, route: MediaRouter.RouteInfo, reason: Int) = read(router)

                override fun onRouteUnselected(router: MediaRouter, route: MediaRouter.RouteInfo, reason: Int) = read(router)

                override fun onRouteChanged(router: MediaRouter, route: MediaRouter.RouteInfo) = read(router)

                fun read(router: MediaRouter) {
                    route = router.selectedRoute.toOutputRoute()
                }
            }
        router.addCallback(selector, callback)
        callback.read(router)
        onDispose { router.removeCallback(callback) }
    }
    return route
}

/**
 * Open the system's output switcher, the same panel the notification shade's media player opens: the
 * phone, Bluetooth devices and whatever speakers the system can hand the sound to. The system moves
 * this app's one player, so the station keeps one listener rather than gaining a second.
 *
 * A phone with no switcher (it answers `false`) gets Bluetooth settings instead, which is where the
 * sound is moved on those phones; with neither, the press does nothing.
 */
fun chooseOutput(context: Context) {
    if (SystemOutputSwitcherDialogController.showDialog(context)) return
    try {
        context.startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: ActivityNotFoundException) {
        // Nothing to open on this phone.
    }
}

private fun MediaRouter.RouteInfo.toOutputRoute(): OutputRoute {
    val kind =
        when {
            isDeviceSpeaker || deviceType == MediaRouter.RouteInfo.DEVICE_TYPE_BUILTIN_SPEAKER -> OutputRoute.Kind.PHONE
            deviceType in BluetoothTypes -> OutputRoute.Kind.BLUETOOTH
            deviceType in WiredTypes -> OutputRoute.Kind.WIRED
            playbackType == MediaRouter.RouteInfo.PLAYBACK_TYPE_REMOTE || deviceType in RemoteTypes -> OutputRoute.Kind.REMOTE
            // The default system route with no type is the phone itself on older releases.
            isDefault -> OutputRoute.Kind.PHONE
            else -> OutputRoute.Kind.OTHER
        }
    return OutputRoute(kind, name)
}

private val BluetoothTypes =
    setOf(
        MediaRouter.RouteInfo.DEVICE_TYPE_BLUETOOTH_A2DP,
        MediaRouter.RouteInfo.DEVICE_TYPE_BLE_HEADSET,
        MediaRouter.RouteInfo.DEVICE_TYPE_HEARING_AID,
    )

private val WiredTypes =
    setOf(
        MediaRouter.RouteInfo.DEVICE_TYPE_WIRED_HEADSET,
        MediaRouter.RouteInfo.DEVICE_TYPE_WIRED_HEADPHONES,
        MediaRouter.RouteInfo.DEVICE_TYPE_USB_DEVICE,
        MediaRouter.RouteInfo.DEVICE_TYPE_USB_ACCESSORY,
        MediaRouter.RouteInfo.DEVICE_TYPE_USB_HEADSET,
        MediaRouter.RouteInfo.DEVICE_TYPE_DOCK,
        MediaRouter.RouteInfo.DEVICE_TYPE_HDMI,
        MediaRouter.RouteInfo.DEVICE_TYPE_HDMI_ARC,
        MediaRouter.RouteInfo.DEVICE_TYPE_HDMI_EARC,
    )

private val RemoteTypes =
    setOf(
        MediaRouter.RouteInfo.DEVICE_TYPE_TV,
        MediaRouter.RouteInfo.DEVICE_TYPE_REMOTE_SPEAKER,
        MediaRouter.RouteInfo.DEVICE_TYPE_AUDIO_VIDEO_RECEIVER,
        MediaRouter.RouteInfo.DEVICE_TYPE_GROUP,
    )
