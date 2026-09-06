package com.maroonedsoftware.deadair

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.ui.NavDisplay
import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.nowplaying.NowPlayingState
import com.maroonedsoftware.deadair.playback.PlayerConnection
import com.maroonedsoftware.deadair.ui.home.HomeRoute
import com.maroonedsoftware.deadair.ui.nav.Destination
import com.maroonedsoftware.deadair.ui.nav.NavConfiguration
import com.maroonedsoftware.deadair.ui.settings.SettingsScreen
import com.maroonedsoftware.deadair.ui.settings.SettingsViewModel
import com.maroonedsoftware.deadair.ui.settings.availableFormats
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

/**
 * The root: what is shared by every screen, and the stack the screens live on.
 *
 * The now-playing reading and the player connection are held here rather than by the tabbed
 * screen, because Settings needs the first (the format picker reads the station's `mounts[]` from
 * it) and the second has to outlive a trip to Settings and back. Everything a single screen owns
 * lives with that screen.
 */
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

    // Keyed on the session so it fires on a cold start with a session already on disk and again
    // after a sign-in, and not on a rotation. What it learns is which controls to draw.
    LaunchedEffect(session) {
        if (session is SessionState.SignedIn) graph.sessions.ensureRoles()
    }

    val context = LocalContext.current
    val connection = remember { PlayerConnection(context) }
    DisposableEffect(Unit) {
        connection.connect()
        onDispose { connection.release() }
    }
    val playback by connection.state.collectAsStateWithLifecycle()
    // Collected here so the poll runs while the app is up. It stops on its own when it is not.
    val nowPlaying by graph.nowPlaying.state.collectAsStateWithLifecycle()

    val backStack = rememberNavBackStack(NavConfiguration, Destination.Home)

    // The stored station is what decides between setup and the app proper: an install that has
    // never been pointed at one has nothing to show, and one that has should not be asked again.
    // Setup is chosen above the stack rather than pushed onto it, so it is not a place back can go.
    val station = settings.station
    if (station == null) {
        SetupScreen(
            state = entry,
            onAddressChange = model::onAddressChange,
            onCheck = model::check,
            onConfirm = model::confirm,
        )
    } else {
        NavDisplay(
            backStack = backStack,
            onBack = { backStack.removeLastOrNull() },
            entryProvider =
                entryProvider {
                    entry<Destination.Home> {
                        HomeRoute(
                            graph = graph,
                            settings = settings,
                            nowPlaying = nowPlaying,
                            playback = playback,
                            connection = connection,
                            onSettings = {
                                model.editExisting(station.origin)
                                backStack.add(Destination.Settings)
                            },
                        )
                    }
                    entry<Destination.Settings> {
                        SettingsScreen(
                            entry = entry,
                            format = settings.format,
                            // From the station's own `mounts[]`, never by connecting to each mount
                            // to see: a connection is an audience, and the gate lingers five
                            // minutes past it.
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
                            hasStation = true,
                            onAddressChange = model::onAddressChange,
                            onCheck = model::check,
                            onConfirm = model::confirm,
                            onFormat = model::setFormat,
                            onEmailChange = model::onEmailChange,
                            onPasswordChange = model::onPasswordChange,
                            onSignIn = model::signIn,
                            onSignOut = model::signOut,
                        )
                    }
                },
        )
    }
}
