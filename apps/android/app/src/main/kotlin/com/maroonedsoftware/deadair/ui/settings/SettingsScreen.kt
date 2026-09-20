package com.maroonedsoftware.deadair.ui.settings

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.playback.SleepRequest
import com.maroonedsoftware.deadair.playback.SleepState
import com.maroonedsoftware.deadair.station.StreamFormat
import com.maroonedsoftware.deadair.wallpaper.ColorSource
import com.maroonedsoftware.deadair.wallpaper.CoverPlacement
import com.maroonedsoftware.deadair.wallpaper.WallpaperFollows
import com.maroonedsoftware.deadair.wallpaper.WallpaperIdle
import com.maroonedsoftware.deadair.widget.WidgetFollows
import com.maroonedsoftware.deadair.ui.PrivacyPolicyLink
import com.maroonedsoftware.deadair.ui.nowplaying.SleepControl
import com.maroonedsoftware.deadair.ui.text.resolve
import com.maroonedsoftware.deadair.ui.theme.FormMaxWidth
import com.maroonedsoftware.deadair.ui.theme.Gutter
import com.maroonedsoftware.deadair.ui.theme.supportsDynamicColor

/**
 * The address, the format and the account, after first run.
 *
 * The format list shows every format the station COULD publish. Which of them it actually does is
 * filled in from `/nowplaying`'s `mounts[]` once a reading has arrived; until then all are offered,
 * because greying a format out on no evidence is worse than offering one that turns out to be off.
 *
 * The account section is optional: listening needs no account, and the station issues only the
 * operator's own. See `AccountSection`. Below it is the privacy policy, and nothing else.
 *
 * The fourth tab rather than a page behind a gear: every app bar carried the gear, which put a
 * settings button above lists that had nothing to do with it. As a tab it draws no bar of its own;
 * the frame's bar says Settings.
 */
@Composable
fun SettingsScreen(
    entry: StationEntryState,
    format: StreamFormat,
    availability: Map<StreamFormat, Boolean>,
    session: SessionState,
    dynamicColor: Boolean,
    wallpaperFollows: WallpaperFollows,
    widgetFollows: WidgetFollows,
    wallpaperIdle: WallpaperIdle,
    wallpaperPlacement: CoverPlacement,
    wallpaperColorSource: ColorSource,
    wallpaperColor: Int,
    playOnOpen: Boolean,
    onAddressChange: (String) -> Unit,
    onCheck: () -> Unit,
    onConfirm: () -> Unit,
    onFormat: (StreamFormat) -> Unit,
    onDynamicColor: (Boolean) -> Unit,
    onWallpaperFollows: (WallpaperFollows) -> Unit,
    onWidgetFollows: (WidgetFollows) -> Unit,
    onWallpaperIdle: (WallpaperIdle) -> Unit,
    onWallpaperPlacement: (CoverPlacement) -> Unit,
    onColorSource: (ColorSource) -> Unit,
    onWallpaperColor: (Int) -> Unit,
    onPlayOnOpen: (Boolean) -> Unit,
    /** Open the sign-in page. */
    onOpenSignIn: () -> Unit,
    onSignOut: () -> Unit,
    /** The sleep timer, as the service last said. */
    sleep: SleepState = SleepState.Off,
    /** Whether the station can say how much of the record is left, which "After this record" needs. */
    canWaitForRecord: Boolean = false,
    /** Set the sleep timer, or `null` to turn it off. No row is drawn without one. */
    onSleep: ((SleepRequest?) -> Unit)? = null,
) {
    // Scroll first and the keyboard's inset inside it, so Sign in is never behind the keyboard. The
    // frame has already padded this by the bars and consumed their insets, so this adds only what
    // the keyboard takes beyond them.
    Box(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding(),
        contentAlignment = Alignment.TopCenter,
    ) {
        Column(
            modifier = Modifier.widthIn(max = FormMaxWidth).fillMaxWidth().padding(horizontal = Gutter),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(stringResource(R.string.section_station), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))

            OutlinedTextField(
                value = entry.address,
                onValueChange = onAddressChange,
                label = { Text(stringResource(R.string.station_address)) },
                singleLine = true,
                isError = entry.error != null,
                supportingText = entry.supportingText?.let { { Text(it.resolve()) } },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { if (entry.showsCheck && entry.address.isNotBlank() && !entry.checking) onCheck() }),
                modifier = Modifier.fillMaxWidth(),
            )

            // No button at all while the field reads as the address already kept: there is
            // nothing to check and nothing to keep. Once edited, Check; once answered, Use.
            // The button keeps its place while the station answers, with the spinner inside
            // it, because swapping the button for a spinner moved the layout on every tap.
            when {
                entry.confirmedName != null ->
                    Button(onClick = onConfirm, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.use_station, entry.confirmedName)) }
                entry.showsCheck ->
                    Button(onClick = onCheck, enabled = entry.address.isNotBlank() && !entry.checking, modifier = Modifier.fillMaxWidth()) {
                        if (entry.checking) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = LocalContentColor.current)
                        } else {
                            Text(stringResource(R.string.check))
                        }
                    }
            }

            HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp))

            Text(stringResource(R.string.section_format), style = MaterialTheme.typography.titleMedium)
            Column(Modifier.selectableGroup()) {
                StreamFormat.entries.forEach { option ->
                    // Absent from the station's `mounts[]` means the operator has not switched
                    // that encoder on. Shown and disabled rather than hidden, so the list is the
                    // same list every time and a listener can see what turning it on would give.
                    val available = availability[option] ?: true
                    ListItem(
                        headlineContent = { Text(option.label) },
                        supportingContent = { Text(stringResource(if (available) describe(option) else R.string.format_not_published)) },
                        // The radio draws the state; the row is what is pressed. A radio that
                        // was the only target left the rest of a full-width row dead, and
                        // TalkBack with a control and a label it could not put together.
                        leadingContent = { RadioButton(selected = option == format, onClick = null, enabled = available) },
                        modifier =
                            Modifier.fillMaxWidth()
                                .selectable(selected = option == format, enabled = available, role = Role.RadioButton, onClick = { onFormat(option) }),
                    )
                }
            }

            HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp))

            Text(stringResource(R.string.section_listening), style = MaterialTheme.typography.titleMedium)
            ListItem(
                headlineContent = { Text(stringResource(R.string.play_on_open)) },
                supportingContent = { Text(stringResource(R.string.play_on_open_detail)) },
                trailingContent = { Switch(checked = playOnOpen, onCheckedChange = null) },
                modifier = Modifier.fillMaxWidth().selectable(selected = playOnOpen, role = Role.Switch, onClick = { onPlayOnOpen(!playOnOpen) }),
            )

            // Only while the station is playing: there is nothing to put to sleep otherwise, and a
            // timer set on a stopped player would fire into whatever play came next. Here rather
            // than under the play button, which now has nothing under it that can come and go.
            onSleep?.let {
                ListItem(
                    headlineContent = { Text(stringResource(R.string.sleep_timer)) },
                    supportingContent = { Text(stringResource(R.string.sleep_timer_detail)) },
                    trailingContent = { SleepControl(sleep = sleep, canWaitForRecord = canWaitForRecord, onSleep = it) },
                )
            }

            // Only where there are wallpaper colors to choose between. Below Android 12 the
            // station's palette is the only one, and a switch that changed nothing would be a lie.
            if (supportsDynamicColor) {
                HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp))

                Text(stringResource(R.string.section_appearance), style = MaterialTheme.typography.titleMedium)
                ListItem(
                    headlineContent = { Text(stringResource(R.string.use_wallpaper_colors)) },
                    supportingContent = { Text(stringResource(R.string.use_wallpaper_colors_detail)) },
                    trailingContent = { Switch(checked = dynamicColor, onCheckedChange = null) },
                    modifier = Modifier.fillMaxWidth().selectable(selected = dynamicColor, role = Role.Switch, onClick = { onDynamicColor(!dynamicColor) }),
                )
            }

            HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp))

            // Under Appearance rather than Listening: it is a picture on the phone, and it draws
            // whether or not this phone is the thing playing.
            Text(stringResource(R.string.wallpaper_section), style = MaterialTheme.typography.titleMedium)
            WallpaperSection(
                follows = wallpaperFollows,
                idle = wallpaperIdle,
                onFollows = onWallpaperFollows,
                onIdle = onWallpaperIdle,
                placement = wallpaperPlacement,
                onPlacement = onWallpaperPlacement,
                colors = wallpaperColorSource,
                color = wallpaperColor,
                onColors = onColorSource,
                onColor = onWallpaperColor,
            )

            HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp))

            // Beside the wallpaper, and for its reason: both are pictures of the station that draw
            // whether or not this phone is the thing playing.
            Text(stringResource(R.string.widget_section), style = MaterialTheme.typography.titleMedium)
            WidgetSection(follows = widgetFollows, onFollows = onWidgetFollows)

            HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp))

            Text(stringResource(R.string.section_account), style = MaterialTheme.typography.titleMedium)
            AccountSection(session = session, onOpenSignIn = onOpenSignIn, onSignOut = onSignOut)

            HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp))

            PrivacyPolicyLink()

            Spacer(Modifier.height(24.dp))
        }
    }
}

/** One line on what choosing each format buys, so the five rows are the same height and the same shape. */
@StringRes
private fun describe(format: StreamFormat): Int =
    when (format) {
        StreamFormat.MP3 -> R.string.format_mp3
        StreamFormat.HLS -> R.string.format_hls
        StreamFormat.AAC -> R.string.format_aac
        StreamFormat.OPUS -> R.string.format_opus
        StreamFormat.FLAC -> R.string.format_flac
    }
