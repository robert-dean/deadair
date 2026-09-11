package com.maroonedsoftware.deadair.ui.setup

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.ui.PrivacyPolicyLink
import com.maroonedsoftware.deadair.ui.settings.StationEntryState
import com.maroonedsoftware.deadair.ui.text.resolve
import com.maroonedsoftware.deadair.ui.theme.FormMaxWidth
import com.maroonedsoftware.deadair.ui.theme.Gutter

/**
 * First run: name a station.
 *
 * Nothing is prefilled. There is no address that is right for more than one person, and a wrong
 * one that looks deliberate is worse than an empty field.
 */
@Composable
fun SetupScreen(
    state: StationEntryState,
    onAddressChange: (String) -> Unit,
    onCheck: () -> Unit,
    onConfirm: () -> Unit,
) {
    Scaffold { padding ->
        // Scroll first and insets inside it, so the content slides under the bars rather than
        // stopping short of them; then the keyboard's own inset, so the button is never behind it.
        Box(
            modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(padding).consumeWindowInsets(padding).imePadding(),
            contentAlignment = Alignment.TopCenter,
        ) {
            Column(
                modifier = Modifier.widthIn(max = FormMaxWidth).fillMaxWidth().padding(horizontal = Gutter, vertical = 24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text(stringResource(R.string.app_name), style = MaterialTheme.typography.headlineMedium)
                Text(stringResource(R.string.setup_intro), style = MaterialTheme.typography.bodyMedium)

                OutlinedTextField(
                    value = state.address,
                    onValueChange = onAddressChange,
                    label = { Text(stringResource(R.string.station_address)) },
                    placeholder = { Text(stringResource(R.string.station_address_example)) },
                    singleLine = true,
                    isError = state.error != null,
                    supportingText = state.supportingText?.let { { Text(it.resolve()) } },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                    // The key says Go, so Go does what the button does. A keyboard promising an
                    // action it will not perform is a small lie told on every press.
                    keyboardActions = KeyboardActions(onGo = { if (state.address.isNotBlank() && !state.checking) onCheck() }),
                    modifier = Modifier.fillMaxWidth(),
                )

                // The button keeps its place while the station answers, with the spinner inside it.
                // Swapping the whole button for a spinner moved the layout on every tap, and left
                // nothing to press while a check that can take five seconds ran.
                if (state.confirmedName != null) {
                    Button(onClick = onConfirm, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.listen_to, state.confirmedName)) }
                } else {
                    Button(onClick = onCheck, enabled = state.address.isNotBlank() && !state.checking, modifier = Modifier.fillMaxWidth()) {
                        if (state.checking) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = LocalContentColor.current)
                        } else {
                            Text(stringResource(R.string.check))
                        }
                    }
                }

                // Before any station, because this is the one screen a person without one can reach.
                PrivacyPolicyLink(modifier = Modifier.align(Alignment.CenterHorizontally))
            }
        }
    }
}
