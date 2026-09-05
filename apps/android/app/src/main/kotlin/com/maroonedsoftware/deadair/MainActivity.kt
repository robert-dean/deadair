package com.maroonedsoftware.deadair

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.maroonedsoftware.deadair.station.StreamFormat
import com.maroonedsoftware.deadair.ui.settings.SettingsScreen
import com.maroonedsoftware.deadair.ui.settings.SettingsViewModel
import com.maroonedsoftware.deadair.ui.setup.SetupScreen
import com.maroonedsoftware.deadair.ui.theme.DeadairTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val graph = (application as DeadairApp).graph
        setContent {
            DeadairTheme {
                Listener(graph)
            }
        }
    }
}

/** Which screen is showing. Three of them do not need a navigation library. */
private enum class Screen { SETUP, NOW_PLAYING, SETTINGS }

@Composable
private fun Listener(graph: AppGraph) {
    val model: SettingsViewModel =
        viewModel(
            factory =
                object : ViewModelProvider.Factory {
                    @Suppress("UNCHECKED_CAST")
                    override fun <T : ViewModel> create(modelClass: Class<T>): T = SettingsViewModel(graph.settings, graph.probe) as T
                },
        )

    val settings by model.settings.collectAsStateWithLifecycle()
    val entry by model.entry.collectAsStateWithLifecycle()
    var showSettings by remember { mutableStateOf(false) }

    // The stored station is what decides between setup and the app proper: an install that has
    // never been pointed at one has nothing to show, and one that has should not be asked again.
    val screen =
        when {
            settings.station == null -> Screen.SETUP
            showSettings -> Screen.SETTINGS
            else -> Screen.NOW_PLAYING
        }

    when (screen) {
        Screen.SETUP ->
            SetupScreen(
                state = entry,
                onAddressChange = model::onAddressChange,
                onCheck = model::check,
                onConfirm = model::confirm,
            )
        Screen.SETTINGS ->
            SettingsScreen(
                entry = entry,
                format = settings.format,
                // Filled in from `/nowplaying`'s `mounts[]` once the poll lands. Empty means "no
                // reading yet", which offers every format rather than greying them on no evidence.
                availability = emptyMap<StreamFormat, Boolean>(),
                onAddressChange = model::onAddressChange,
                onCheck = model::check,
                onConfirm = model::confirm,
                onFormat = model::setFormat,
            )
        Screen.NOW_PLAYING ->
            NowPlayingPlaceholder(
                station = settings.station?.origin.orEmpty(),
                format = settings.format,
                onSettings = {
                    settings.station?.let { model.editExisting(it.origin) }
                    showSettings = true
                },
            )
    }
}

/** Stands in until the now-playing screen lands. It proves the stored station reached the app. */
@Composable
private fun NowPlayingPlaceholder(station: String, format: StreamFormat, onSettings: () -> Unit) {
    Scaffold { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(station, style = MaterialTheme.typography.titleMedium)
            Text("Listening in ${format.label}", style = MaterialTheme.typography.bodyMedium)
            Button(onClick = onSettings) { Text("Settings") }
        }
    }
}
