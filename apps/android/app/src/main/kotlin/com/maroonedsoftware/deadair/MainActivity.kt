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
import androidx.compose.runtime.DisposableEffect
import com.maroonedsoftware.deadair.nowplaying.NowPlayingState
import com.maroonedsoftware.deadair.nowplaying.airState
import com.maroonedsoftware.deadair.nowplaying.AirState
import com.maroonedsoftware.deadair.playback.PlayerConnection
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

    val context = androidx.compose.ui.platform.LocalContext.current
    val connection = remember { PlayerConnection(context) }
    DisposableEffect(Unit) {
        connection.connect()
        onDispose { connection.release() }
    }
    val playback by connection.state.collectAsStateWithLifecycle()
    // Collected here so the poll runs while the screen is up. It stops on its own when it is not.
    val nowPlaying by graph.nowPlaying.state.collectAsStateWithLifecycle()

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
                air = airState(nowPlaying, playback.requested),
                listeners = (nowPlaying as? NowPlayingState.Answered)?.reading?.nowPlaying?.listeners ?: 0,
                format = settings.format,
                playing = playback.requested,
                onPlay = connection::play,
                onStop = connection::stop,
                onSettings = {
                    settings.station?.let { model.editExisting(it.origin) }
                    showSettings = true
                },
            )
    }
}

/** Stands in until the now-playing screen lands. It proves the session is driving the stream. */
@Composable
private fun NowPlayingPlaceholder(
    air: AirState,
    listeners: Long,
    format: StreamFormat,
    playing: Boolean,
    onPlay: () -> Unit,
    onStop: () -> Unit,
    onSettings: () -> Unit,
) {
    Scaffold { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val line =
                when (air) {
                    is AirState.OnAir -> "${air.track.title} — ${air.track.artist}"
                    AirState.WarmingUp -> "Warming up"
                    AirState.OffAir -> "Off air"
                    AirState.Unreachable -> "Station unreachable"
                }
            Text(line, style = MaterialTheme.typography.titleMedium)
            Text("$listeners listening · ${format.label}", style = MaterialTheme.typography.bodyMedium)
            Button(onClick = if (playing) onStop else onPlay) { Text(if (playing) "Stop" else "Play") }
            Button(onClick = onSettings) { Text("Settings") }
        }
    }
}
