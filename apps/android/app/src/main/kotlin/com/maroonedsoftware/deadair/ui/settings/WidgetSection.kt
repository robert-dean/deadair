package com.maroonedsoftware.deadair.ui.settings

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
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
import com.maroonedsoftware.deadair.widget.StationWidgetReceiver
import com.maroonedsoftware.deadair.widget.WidgetFollows

/**
 * The home-screen widget: when it shows what is on, and a way to put one there.
 *
 * The choice is the live wallpaper's, in the same words, because it is the same question — and it
 * matters more here than it reads: [WidgetFollows.THIS_PHONE] schedules no background work at all,
 * so an install that never touches this setting never asks the station anything on its own.
 */
@Composable
fun WidgetSection(follows: WidgetFollows, onFollows: (WidgetFollows) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    // Launchers are not obliged to offer pinning, and one that does not would leave a button that
    // does nothing. Asked once, of the platform.
    val canPin = remember(context) { AppWidgetManager.getInstance(context).isRequestPinAppWidgetSupported }

    Column(modifier = modifier.fillMaxWidth()) {
        if (canPin) {
            Button(onClick = { pin(context) }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.widget_add)) }
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
    }
}

@Composable
private fun Choice(@StringRes label: Int, @StringRes detail: Int, selected: Boolean, onSelect: () -> Unit) {
    ListItem(
        headlineContent = { Text(stringResource(label)) },
        supportingContent = { Text(stringResource(detail)) },
        leadingContent = { RadioButton(selected = selected, onClick = null) },
        modifier = Modifier.fillMaxWidth().selectable(selected = selected, role = Role.RadioButton, onClick = onSelect),
    )
}

/**
 * Ask the launcher to place one.
 *
 * A request rather than a placement: the launcher draws its own dialog and the listener says yes,
 * which is the only way an app may put anything on somebody's home screen. A launcher that refuses
 * is why the button is hidden where pinning is unsupported.
 */
private fun pin(context: Context) {
    runCatching {
        AppWidgetManager.getInstance(context).requestPinAppWidget(ComponentName(context, StationWidgetReceiver::class.java), null, null)
    }
}

private val FOLLOWS =
    listOf(
        WidgetFollows.THIS_PHONE to R.string.widget_follows_this_phone,
        WidgetFollows.STATION to R.string.widget_follows_station,
    )

@StringRes
private fun detailOf(follows: WidgetFollows): Int =
    when (follows) {
        WidgetFollows.THIS_PHONE -> R.string.widget_follows_this_phone_detail
        WidgetFollows.STATION -> R.string.widget_follows_station_detail
    }
