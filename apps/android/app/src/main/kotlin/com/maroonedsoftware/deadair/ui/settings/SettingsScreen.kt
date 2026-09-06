package com.maroonedsoftware.deadair.ui.settings

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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.station.StreamFormat
import com.maroonedsoftware.deadair.ui.theme.FormMaxWidth
import com.maroonedsoftware.deadair.ui.theme.Gutter

/**
 * The address and the format, after first run.
 *
 * The account section is last and is optional: listening needs no account, and the station issues
 * only the operator's own. See `AccountSection`.
 *
 * The format list shows every format the station COULD publish. Which of them it actually does is
 * filled in from `/nowplaying`'s `mounts[]` once a reading has arrived; until then all are offered,
 * because greying a format out on no evidence is worse than offering one that turns out to be off.
 */
@Composable
fun SettingsScreen(
    entry: StationEntryState,
    format: StreamFormat,
    availability: Map<StreamFormat, Boolean>,
    session: SessionState,
    account: AccountState,
    hasStation: Boolean,
    onAddressChange: (String) -> Unit,
    onCheck: () -> Unit,
    onConfirm: () -> Unit,
    onFormat: (StreamFormat) -> Unit,
    onEmailChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onSignIn: () -> Unit,
    onSignOut: () -> Unit,
) {
    Scaffold { padding ->
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
                Text("Station", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 24.dp))

                OutlinedTextField(
                    value = entry.address,
                    onValueChange = onAddressChange,
                    label = { Text("Station address") },
                    singleLine = true,
                    isError = entry.error != null,
                    supportingText = entry.supportingText?.let { { Text(it) } },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = { if (entry.address.isNotBlank() && !entry.checking) onCheck() }),
                    modifier = Modifier.fillMaxWidth(),
                )

                when {
                    entry.checking -> CircularProgressIndicator()
                    entry.confirmedName != null ->
                        Button(onClick = onConfirm, modifier = Modifier.fillMaxWidth()) { Text("Use ${entry.confirmedName}") }
                    else -> Button(onClick = onCheck, enabled = entry.address.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text("Check") }
                }

                HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp))

                Text("Format", style = MaterialTheme.typography.titleMedium)
                Column(Modifier.selectableGroup()) {
                    StreamFormat.entries.forEach { option ->
                        // Absent from the station's `mounts[]` means the operator has not switched
                        // that encoder on. Shown and disabled rather than hidden, so the list is the
                        // same list every time and a listener can see what turning it on would give.
                        val available = availability[option] ?: true
                        ListItem(
                            headlineContent = { Text(option.label) },
                            supportingContent =
                                when {
                                    !available -> ({ Text("Not published by this station") })
                                    option == StreamFormat.HLS -> ({ Text("Survives moving between wifi and mobile data") })
                                    option == StreamFormat.MP3 -> ({ Text("Always available") })
                                    else -> null
                                },
                            leadingContent = {
                                RadioButton(selected = option == format, onClick = { onFormat(option) }, enabled = available)
                            },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }

                HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp))

                Text("Account", style = MaterialTheme.typography.titleMedium)
                AccountSection(
                    session = session,
                    account = account,
                    signedInEnabled = hasStation,
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
