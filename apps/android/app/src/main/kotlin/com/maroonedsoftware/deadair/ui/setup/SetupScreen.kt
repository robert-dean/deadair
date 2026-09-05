package com.maroonedsoftware.deadair.ui.setup

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.ui.settings.StationEntryState

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
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("deadair", style = MaterialTheme.typography.headlineMedium)
            Text(
                "The address your station's console loads from. The same one carries the stream.",
                style = MaterialTheme.typography.bodyMedium,
            )

            OutlinedTextField(
                value = state.address,
                onValueChange = onAddressChange,
                label = { Text("Station address") },
                placeholder = { Text("https://radio.example.com") },
                singleLine = true,
                isError = state.error != null,
                supportingText = state.supportingText?.let { { Text(it) } },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                modifier = Modifier.fillMaxWidth(),
            )

            if (state.checking) {
                CircularProgressIndicator()
            } else if (state.confirmedName != null) {
                Button(onClick = onConfirm, modifier = Modifier.fillMaxWidth()) { Text("Listen to ${state.confirmedName}") }
            } else {
                Button(onClick = onCheck, enabled = state.address.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
                    Text("Check")
                }
            }
        }
    }
}
