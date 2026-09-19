package com.maroonedsoftware.deadair

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.BackHandler
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
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
import kotlinx.coroutines.flow.MutableStateFlow
import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.nowplaying.NowPlayingState
import com.maroonedsoftware.deadair.playback.PlayerConnection
import com.maroonedsoftware.deadair.playback.playOnOpen
import com.maroonedsoftware.deadair.station.StationLink
import com.maroonedsoftware.deadair.ui.nowplaying.rememberPlayhead
import com.maroonedsoftware.deadair.ui.nowplaying.rememberPlayWithNotificationsAsked
import com.maroonedsoftware.deadair.ui.add.AddRecordRoute
import com.maroonedsoftware.deadair.ui.air.AirSomethingRoute
import com.maroonedsoftware.deadair.ui.air.ChartRoute
import com.maroonedsoftware.deadair.ui.air.PlaylistRoute
import com.maroonedsoftware.deadair.ui.catalog.AlbumRoute
import com.maroonedsoftware.deadair.ui.catalog.ArtistRoute
import com.maroonedsoftware.deadair.ui.catalog.TrackRoute
import com.maroonedsoftware.deadair.ui.desk.DeskRoute
import com.maroonedsoftware.deadair.ui.history.HistoryRoute
import com.maroonedsoftware.deadair.ui.home.HomeRoute
import com.maroonedsoftware.deadair.ui.home.Tab
import com.maroonedsoftware.deadair.ui.nav.Destination
import com.maroonedsoftware.deadair.ui.nav.NavConfiguration
import com.maroonedsoftware.deadair.ui.plan.PlanRoute
import com.maroonedsoftware.deadair.ui.scripts.ScriptsRoute
import com.maroonedsoftware.deadair.ui.settings.SignInScreen
import com.maroonedsoftware.deadair.ui.settings.SettingsScreen
import com.maroonedsoftware.deadair.ui.settings.SettingsViewModel
import com.maroonedsoftware.deadair.ui.settings.availableFormats
import com.maroonedsoftware.deadair.ui.setup.SetupScreen
import com.maroonedsoftware.deadair.ui.text.LocalUses24HourClock
import com.maroonedsoftware.deadair.ui.theme.DeadairTheme

class MainActivity : ComponentActivity() {
    /**
     * A `deadair://` link waiting to be offered. Set from the intent that launched the activity and
     * from every one after it (`singleTask` delivers those to `onNewIntent`), and cleared once shown.
     */
    private val links = MutableStateFlow<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Not on a restore: the launching intent is still attached after a rotation, and offering its
        // link again would reopen a question the listener has already answered.
        if (savedInstanceState == null) links.value = linkIn(intent)
        val graph = (application as DeadairApp).graph
        setContent {
            // The theme reads the one setting it depends on straight from the store, above the
            // screens, so it can be applied before there is a screen to apply it to.
            val settings by graph.settings.settings.collectAsStateWithLifecycle(initialValue = null)

            // The phone's own clock preference, read once here so nothing below reaches for
            // `android.text.format` and everything that writes a time agrees.
            CompositionLocalProvider(LocalUses24HourClock provides DateFormat.is24HourFormat(this)) {
                DeadairTheme(dynamicColour = settings?.dynamicColour ?: true) {
                    Listener(graph, links)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        linkIn(intent)?.let { links.value = it }
    }

    private fun linkIn(intent: Intent?): String? = intent?.takeIf { it.action == Intent.ACTION_VIEW }?.dataString
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
private fun Listener(graph: AppGraph, links: MutableStateFlow<String?>) {
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
    val proposal by model.proposal.collectAsStateWithLifecycle()
    val link by links.collectAsStateWithLifecycle()

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

    // Play when the app opens, if the listener asked for that. Decided ONCE per activity, at the
    // first moment it can be (the controller bound, the settings read), and kept across rotation and
    // a restore: those are returns, not opens. Toggling the setting on later does not start anything.
    val playOnce = rememberPlayWithNotificationsAsked(connection::play)
    var openDecided by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(playback.connected, settings) {
        if (openDecided) return@LaunchedEffect
        val play = playOnOpen(playback.connected, settings, playback.requested) ?: return@LaunchedEffect
        openDecided = true
        if (play) playOnce()
    }

    val backStack = rememberNavBackStack(NavConfiguration, Destination.Home)
    // Which tab Home shows. Held here rather than inside Home so the Settings tab, drawn from here,
    // can send the app back to Now playing on a new station; saveable, so a rotation keeps it.
    var tab by rememberSaveable { mutableStateOf(Tab.NOW_PLAYING) }
    // Leaving the sign-in page, by its arrow, by system back or by succeeding, starts the sign-in
    // again: the password goes, and a code step's challenge has a clock that will have run out by
    // the time anybody comes back to it. Keyed on the page being on the stack rather than on its
    // composition, so a rotation mid-code keeps the code step.
    val signingIn = Destination.SignIn in backStack
    LaunchedEffect(signingIn) { if (!signingIn) model.startAgain() }
    val openSignIn = { if (backStack.lastOrNull() != Destination.SignIn) backStack.add(Destination.SignIn) }

    // The stored station is what decides between setup and the app proper: an install that has
    // never been pointed at one has nothing to show, and one that has should not be asked again.
    // Setup is chosen above the stack rather than pushed onto it, so it is not a place back can go.
    //
    // Until the first read from disk lands there is no answer, and the honest thing to draw is
    // nothing: the launch window is still on screen, and drawing Setup for the few frames before
    // the station arrives was a flash of the wrong screen on every cold start.
    //
    // A `deadair://` link is the one thing that shows Setup over a kept station, and only ever
    // PROPOSES: the kept station, its session and what is playing stay until the new address has
    // answered and somebody has pressed Listen. Offered once the settings are read, because a link
    // that launched the app arrives before them and "is this the station I have" needs both.
    val loaded = settings
    val station = loaded?.station
    LaunchedEffect(link, loaded != null) {
        val text = link ?: return@LaunchedEffect
        if (loaded == null) return@LaunchedEffect
        links.value = null
        StationLink.parse(text)?.let { model.propose(it, station) }
    }
    val keepCurrent = { model.keepCurrent(station) }
    BackHandler(enabled = proposal != null && station != null, onBack = keepCurrent)

    if (loaded == null) {
        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background))
    } else if (station == null || proposal != null) {
        SetupScreen(
            state = entry,
            onAddressChange = model::onAddressChange,
            onCheck = model::check,
            onConfirm = model::confirm,
            listeningTo = if (proposal != null) station?.let { loaded.stationName ?: it.origin } else null,
            onKeepCurrent = if (proposal != null && station != null) keepCurrent else null,
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
                            tab = tab,
                            onTab = { tab = it },
                            onSignIn = openSignIn,
                            settingsTab = {
                                // Seeds the address field with the kept station the first time the
                                // tab is drawn, and never over an edit in progress.
                                LaunchedEffect(station.origin) { model.editExisting(station.origin) }
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
                                    dynamicColour = loaded.dynamicColour,
                                    playOnOpen = loaded.playOnOpen,
                                    onAddressChange = model::onAddressChange,
                                    onCheck = model::check,
                                    // Keeping a station is the end of the errand, so the app goes back to
                                    // what is on. The now-playing poll restarts against the new address.
                                    onConfirm = {
                                        model.confirm()
                                        tab = Tab.NOW_PLAYING
                                    },
                                    onFormat = model::setFormat,
                                    onDynamicColour = model::setDynamicColour,
                                    onPlayOnOpen = model::setPlayOnOpen,
                                    onOpenSignIn = openSignIn,
                                    onSignOut = model::signOut,
                                    sleep = playback.sleep,
                                    canWaitForRecord = rememberPlayhead((nowPlaying as? NowPlayingState.Answered)?.reading) != null,
                                    onSleep =
                                        if (playback.requested) {
                                            { request -> if (request == null) connection.clearSleep() else connection.armSleep(request) }
                                        } else {
                                            null
                                        },
                                )
                            },
                            onTrack = { id -> backStack.add(Destination.Track(id)) },
                            onHistory = { backStack.add(Destination.History) },
                            onDesk = { backStack.add(Destination.Desk) },
                            onAirSomething = { backStack.add(Destination.AirSomething) },
                            onAddRecord = { backStack.add(Destination.AddRecord) },
                            onScripts = { segmentId -> backStack.add(Destination.Scripts(segmentId)) },
                            onPlan = { currentBrief, somethingOn -> backStack.add(Destination.Plan(currentBrief, somethingOn)) },
                        )
                    }
                    entry<Destination.Plan> { key ->
                        PlanRoute(
                            graph = graph,
                            currentBrief = key.currentBrief,
                            somethingOn = key.somethingOn,
                            onBack = { backStack.removeLastOrNull() },
                            // Replanning and going on air both end the errand: the stack unwinds to
                            // Home, where the tab shows what the station did with it.
                            onDone = { while (backStack.size > 1) backStack.removeLastOrNull() },
                        )
                    }
                    entry<Destination.History> {
                        HistoryRoute(
                            graph = graph,
                            settings = loaded,
                            onBack = { backStack.removeLastOrNull() },
                            onSignIn = openSignIn,
                            onTrack = { id -> backStack.add(Destination.Track(id)) },
                        )
                    }
                    entry<Destination.SignIn> {
                        // Closed as soon as there is a session: the page's work is done, and the
                        // screen under it is the one that wanted it.
                        LaunchedEffect(session) {
                            if (session is SessionState.SignedIn && backStack.lastOrNull() == Destination.SignIn) backStack.removeLastOrNull()
                        }
                        SignInScreen(
                            station = loaded.stationName ?: station.origin,
                            account = account,
                            onBack = { backStack.removeLastOrNull() },
                            onEmailChange = model::onEmailChange,
                            onPasswordChange = model::onPasswordChange,
                            onCodeChange = model::onCodeChange,
                            onSignIn = model::signIn,
                            onStartAgain = model::startAgain,
                        )
                    }
                    entry<Destination.Desk> {
                        DeskRoute(graph = graph, settings = loaded, onBack = { backStack.removeLastOrNull() }, onSignIn = openSignIn)
                    }
                    entry<Destination.Scripts> { key ->
                        ScriptsRoute(
                            graph = graph,
                            segmentId = key.segmentId,
                            onBack = { backStack.removeLastOrNull() },
                            onSignIn = openSignIn,
                        )
                    }
                    entry<Destination.AirSomething> {
                        AirSomethingRoute(
                            graph = graph,
                            onBack = { backStack.removeLastOrNull() },
                            onPlaylist = { pluginId, playlistId -> backStack.add(Destination.Playlist(pluginId, playlistId)) },
                            onChart = { id -> backStack.add(Destination.Chart(id)) },
                        )
                    }
                    entry<Destination.AddRecord> {
                        AddRecordRoute(graph = graph, onBack = { backStack.removeLastOrNull() })
                    }
                    // Airing something ends the errand: the stack unwinds to Home, where the
                    // transport shows what just happened.
                    entry<Destination.Playlist> { key ->
                        PlaylistRoute(
                            graph = graph,
                            pluginId = key.pluginId,
                            playlistId = key.playlistId,
                            onBack = { backStack.removeLastOrNull() },
                            onAired = { while (backStack.size > 1) backStack.removeLastOrNull() },
                        )
                    }
                    entry<Destination.Chart> { key ->
                        ChartRoute(
                            graph = graph,
                            chartId = key.id,
                            onBack = { backStack.removeLastOrNull() },
                            onAired = { while (backStack.size > 1) backStack.removeLastOrNull() },
                        )
                    }
                    entry<Destination.Track> { key ->
                        TrackRoute(
                            graph = graph,
                            settings = loaded,
                            trackId = key.id,
                            onBack = { backStack.removeLastOrNull() },
                            onArtist = { id -> backStack.add(Destination.Artist(id)) },
                            onAlbum = { id -> backStack.add(Destination.Album(id)) },
                        )
                    }
                    entry<Destination.Album> { key ->
                        AlbumRoute(
                            graph = graph,
                            settings = loaded,
                            albumId = key.id,
                            onBack = { backStack.removeLastOrNull() },
                            onArtist = { id -> backStack.add(Destination.Artist(id)) },
                            onTrack = { id -> backStack.add(Destination.Track(id)) },
                        )
                    }
                    entry<Destination.Artist> { key ->
                        ArtistRoute(
                            graph = graph,
                            settings = loaded,
                            artistId = key.id,
                            onBack = { backStack.removeLastOrNull() },
                            onAlbum = { id -> backStack.add(Destination.Album(id)) },
                        )
                    }
                },
        )
    }
}
