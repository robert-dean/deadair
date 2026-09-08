package com.maroonedsoftware.deadair.ui.nowplaying

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

/**
 * The play action, with the notification permission asked for on the way.
 *
 * Asked at the first press of play rather than at launch, because that is the moment a listener
 * can see what the notification would be for. A notification tied to a media session is exempt
 * from the permission on Android 13 and later, but the exemption is easy to lose to a future
 * platform release or a manufacturer's build, and asking costs one dialog once: the system stops
 * showing it after it has been refused twice, and the launcher answers straight away after that.
 *
 * Play runs FIRST, so the station starts while the dialog is up rather than after it is dismissed.
 */
@Composable
fun rememberPlayWithNotificationsAsked(play: () -> Unit): () -> Unit {
    val context = LocalContext.current
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { /* Granted or not, the station plays. */ }

    return {
        play()
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            ask.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
