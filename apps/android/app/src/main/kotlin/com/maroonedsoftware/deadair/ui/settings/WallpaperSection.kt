package com.maroonedsoftware.deadair.ui.settings

import android.app.WallpaperManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.Button
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.wallpaper.StationWallpaperService
import com.maroonedsoftware.deadair.wallpaper.WallpaperFollows
import com.maroonedsoftware.deadair.wallpaper.WallpaperIdle

/**
 * The station wallpaper: how to put it on, and the two things it can be told.
 *
 * One composable and two homes, because a live wallpaper has two places a listener looks for its
 * settings: the app, and the Settings button the system's own wallpaper picker draws. Both show
 * this.
 *
 * The button opens the picker on this wallpaper rather than setting it: taking somebody's wallpaper
 * without their say so is exactly what the whole design avoids, and the picker is also where they
 * choose whether it goes on the lock screen, the home screen or both.
 */
@Composable
fun WallpaperSection(
    follows: WallpaperFollows,
    idle: WallpaperIdle,
    onFollows: (WallpaperFollows) -> Unit,
    onIdle: (WallpaperIdle) -> Unit,
    /** The button, for the app's settings. Left out inside the picker, which is already here. */
    showsSetButton: Boolean = true,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val offers = remember(context) { showsSetButton && context.packageManager.hasSystemFeature(PackageManager.FEATURE_LIVE_WALLPAPER) }

    Column(modifier = modifier.fillMaxWidth()) {
        if (offers) {
            Button(onClick = { openPicker(context) }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.wallpaper_set)) }
        }

        Text(
            stringResource(R.string.wallpaper_shows),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.fillMaxWidth(),
        )
        Column(Modifier.selectableGroup()) {
            FOLLOWS.forEach { (option, label) ->
                Choice(label = label, detail = detailOf(option), selected = option == follows, onSelect = { onFollows(option) })
            }
        }

        Text(
            stringResource(R.string.wallpaper_otherwise),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.fillMaxWidth(),
        )
        Column(Modifier.selectableGroup()) {
            IDLES.forEach { (option, label) ->
                Choice(label = label, detail = null, selected = option == idle, onSelect = { onIdle(option) })
            }
        }
    }
}

@Composable
private fun Choice(@StringRes label: Int, @StringRes detail: Int?, selected: Boolean, onSelect: () -> Unit) {
    ListItem(
        headlineContent = { Text(stringResource(label)) },
        supportingContent = detail?.let { { Text(stringResource(it)) } },
        // The radio draws the state and the row is what is pressed, as the format rows are.
        leadingContent = { RadioButton(selected = selected, onClick = null) },
        modifier = Modifier.fillMaxWidth().selectable(selected = selected, role = Role.RadioButton, onClick = onSelect),
    )
}

/**
 * Open the system's picker on this wallpaper, and fall back to the plain wallpaper chooser.
 *
 * Whether the button is drawn at all is `FEATURE_LIVE_WALLPAPER`, which is a question about the
 * PLATFORM and needs no package visibility. Asking the package manager which activity handles the
 * intent is the obvious gate and the wrong one: from API 30 an app sees only the intents it has
 * declared an interest in, and on this phone — which has a picker, and answers `resolve-activity`
 * with it from a shell — the app's own resolve came back empty and hid the button.
 *
 * The fallback covers the other half of that: a platform that says it has live wallpapers and no
 * activity to change one. Better a chooser than a button that does nothing.
 */
private fun openPicker(context: Context) {
    val live =
        Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER)
            .putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, ComponentName(context, StationWallpaperService::class.java))
    runCatching { context.startActivity(live) }
        .recoverCatching { context.startActivity(Intent(Intent.ACTION_SET_WALLPAPER)) }
}

@StringRes
private fun detailOf(follows: WallpaperFollows): Int =
    when (follows) {
        WallpaperFollows.THIS_PHONE -> R.string.wallpaper_this_phone_detail
        WallpaperFollows.STATION -> R.string.wallpaper_station_detail
    }

private val FOLLOWS =
    listOf(
        WallpaperFollows.THIS_PHONE to R.string.wallpaper_this_phone,
        WallpaperFollows.STATION to R.string.wallpaper_station,
    )

private val IDLES =
    listOf(
        WallpaperIdle.LAST_COVER to R.string.wallpaper_last_cover,
        WallpaperIdle.MARK to R.string.wallpaper_mark,
        WallpaperIdle.PLAIN to R.string.wallpaper_plain,
    )
