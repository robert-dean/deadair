package com.maroonedsoftware.deadair

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import android.text.format.DateFormat
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
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
import com.maroonedsoftware.deadair.ui.catalog.TrackRoute
import com.maroonedsoftware.deadair.ui.home.HomeRoute
import com.maroonedsoftware.deadair.ui.nav.Destination
import com.maroonedsoftware.deadair.ui.nav.NavConfiguration
import com.maroonedsoftware.deadair.ui.settings.SettingsScreen
import com.maroonedsoftware.deadair.ui.settings.SettingsViewModel
import com.maroonedsoftware.deadair.ui.settings.availableFormats
import com.maroonedsoftware.deadair.ui.setup.SetupScreen
import com.maroonedsoftware.deadair.ui.text.LocalUses24HourClock
import com.maroonedsoftware.deadair.ui.theme.DeadairTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val graph = (application as DeadairApp).graph
        setContent {
            // The theme reads the one setting it depends on straight from the store, above the
            // screens, so it can be applied before there is a screen to apply it to.
            val settings by graph.settings.settings.collectAsStateWithLifecycle(initialValue = null)

            // The phone's own clock preference, read once here so nothing below reaches for
            // `android.text.format` and everything that writes a time agrees.
            CompositionLocalProvider(LocalUses24HourClock provides DateFormat.is24HourFormat(this)) {
                DeadairTheme(dynamicColour = settings?.dynamicColour ?: true) {
                    Listener(graph)
                }
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
    //
    // Until the first read from disk lands there is no answer, and the honest thing to draw is
    // nothing: the launch window is still on screen, and drawing Setup for the few frames before
    // the station arrives was a flash of the wrong screen on every cold start.
    val loaded = settings
    val station = loaded?.station
    if (loaded == null) {
        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background))
    } else if (station == null) {
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
                            settings = loaded,
                            nowPlaying = nowPlaying,
                            playback = playback,
                            connection = connection,
                            onSettings = {
                                model.editExisting(station.origin)
                                backStack.add(Destination.Settings)
                            },
                            onTrack = { id -> backStack.add(Destination.Track(id)) },
                        )
                    }
                    entry<Destination.Track> { key ->
                        TrackRoute(
                            graph = graph,
                            settings = loaded,
                            trackId = key.id,
                            onBack = { backStack.removeLastOrNull() },
                            // The album and artist pages arrive in the next phase; until then the
                            // credit and the album are drawn as words rather than as links.
                            onArtist = null,
                            onAlbum = null,
                        )
                    }
                    entry<Destination.Settings> {
                        SettingsScreen(
                            entry = entry,
                            format = loaded.format,
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
                            dynamicColour = loaded.dynamicColour,
                            onBack = { backStack.removeLastOrNull() },
                            onAddressChange = model::onAddressChange,
                            onCheck = model::check,
                            // Keeping a station is the end of the errand, so the screen closes on
                            // it. The now-playing poll restarts against the new address on its own.
                            onConfirm = {
                                model.confirm()
                                backStack.removeLastOrNull()
                            },
                            onFormat = model::setFormat,
                            onDynamicColour = model::setDynamicColour,
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
