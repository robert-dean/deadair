package com.maroonedsoftware.deadair.ui.settings

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.consumeWindowInsets
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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.station.StreamFormat
import com.maroonedsoftware.deadair.ui.text.resolve
import com.maroonedsoftware.deadair.ui.theme.FormMaxWidth
import com.maroonedsoftware.deadair.ui.theme.Gutter

/**
 * The address, the format and the account, after first run.
 *
 * The format list shows every format the station COULD publish. Which of them it actually does is
 * filled in from `/nowplaying`'s `mounts[]` once a reading has arrived; until then all are offered,
 * because greying a format out on no evidence is worse than offering one that turns out to be off.
 *
 * The account section is last and is optional: listening needs no account, and the station issues
 * only the operator's own. See `AccountSection`.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    entry: StationEntryState,
    format: StreamFormat,
    availability: Map<StreamFormat, Boolean>,
    session: SessionState,
    account: AccountState,
    onBack: () -> Unit,
    onAddressChange: (String) -> Unit,
    onCheck: () -> Unit,
    onConfirm: () -> Unit,
    onFormat: (StreamFormat) -> Unit,
    onEmailChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onSignIn: () -> Unit,
    onSignOut: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.settings)) },
                // A way out that is on the screen. System back always worked; a screen with no
                // title and no arrow read as somewhere you had been dropped rather than gone.
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = stringResource(R.string.back))
                    }
                },
            )
        },
    ) { padding ->
        // Scroll first and insets inside it, so the content slides under the bars rather than
        // stopping short of them; then the keyboard's own inset, so Sign in is never behind it.
        Box(
            modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(padding).consumeWindowInsets(padding).imePadding(),
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
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
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

                Text(stringResource(R.string.section_account), style = MaterialTheme.typography.titleMedium)
                AccountSection(
                    session = session,
                    account = account,
                    onEmailChange = onEmailChange,
                    onPasswordChange = onPasswordChange,
                    onSignIn = onSignIn,
                    onSignOut = onSignOut,
                )

                Spacer(Modifier.height(24.dp))
            }
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
