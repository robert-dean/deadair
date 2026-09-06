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
import com.maroonedsoftware.deadair.playback.chooseMount
import com.maroonedsoftware.deadair.ui.nowplaying.NowPlayingScreen
import com.maroonedsoftware.deadair.ui.nowplaying.NowPlayingUiState
import com.maroonedsoftware.deadair.ui.nowplaying.rememberPlayhead
import com.maroonedsoftware.deadair.ui.settings.SettingsScreen
import com.maroonedsoftware.deadair.ui.settings.availableFormats
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
                    override fun <T : ViewModel> create(modelClass: Class<T>): T =
                        SettingsViewModel(graph.settings, graph.probe, graph.sessions) as T
                },
        )

    val settings by model.settings.collectAsStateWithLifecycle()
    val entry by model.entry.collectAsStateWithLifecycle()
    val session by model.session.collectAsStateWithLifecycle()
    val account by model.account.collectAsStateWithLifecycle()
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
                // From the station's own `mounts[]`, never by connecting to each mount to see: a
                // connection is an audience, and the gate lingers five minutes past it.
                availability =
                    availableFormats(
                        when (val current = nowPlaying) {
                            is NowPlayingState.Answered -> current.reading.nowPlaying.mounts
                            is NowPlayingState.Unreachable -> current.lastGood?.nowPlaying?.mounts
                            NowPlayingState.Loading -> null
                        },
                    ),
                session = session,
                account = account,
                hasStation = settings.station != null,
                onAddressChange = model::onAddressChange,
                onCheck = model::check,
                onConfirm = model::confirm,
                onFormat = model::setFormat,
                onEmailChange = model::onEmailChange,
                onPasswordChange = model::onPasswordChange,
                onSignIn = model::signIn,
                onSignOut = model::signOut,
            )
        Screen.NOW_PLAYING -> {
            val station = settings.station
            val reading =
                when (val current = nowPlaying) {
                    is NowPlayingState.Answered -> current.reading
                    is NowPlayingState.Unreachable -> current.lastGood
                    NowPlayingState.Loading -> null
                }
            val air = airState(nowPlaying, playback.requested)
            val choice = chooseMount(reading?.nowPlaying?.mounts.orEmpty(), settings.format)

            NowPlayingScreen(
                state =
                    NowPlayingUiState(
                        station = reading?.nowPlaying?.station ?: station?.origin.orEmpty(),
                        air = air,
                        listeners = reading?.nowPlaying?.listeners ?: 0,
                        format = settings.format,
                        playing = playback.requested,
                        buffering = playback.buffering,
                        // Only worth saying while something is actually playing; before that it is
                        // a guess about a station that has not answered yet.
                        fellBackToMp3 = choice.fellBack && playback.requested,
                        stale = nowPlaying is NowPlayingState.Unreachable,
                    ),
                artworkUrl = station?.artUrl(reading?.nowPlaying?.track?.artworkUrl),
                // Frozen while the station is unreachable: a bar still sweeping from a reading
                // minutes old is a moving, confident lie about where the record is.
                playhead = rememberPlayhead(reading.takeIf { nowPlaying is NowPlayingState.Answered }),
                onPlay = connection::play,
                onStop = connection::stop,
                onSettings = {
                    station?.let { model.editExisting(it.origin) }
                    showSettings = true
                },
            )
        }
    }
}
