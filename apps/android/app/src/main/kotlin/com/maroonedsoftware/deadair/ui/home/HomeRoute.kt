package com.maroonedsoftware.deadair.ui.home

import androidx.activity.compose.BackHandler
import androidx.compose.runtime.Composable
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import com.maroonedsoftware.deadair.R
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maroonedsoftware.deadair.AppGraph
import com.maroonedsoftware.deadair.auth.Notice
import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.nowplaying.NowPlayingState
import com.maroonedsoftware.deadair.nowplaying.airState
import com.maroonedsoftware.deadair.playback.PlayerConnection
import com.maroonedsoftware.deadair.playback.PlayerUiState
import com.maroonedsoftware.deadair.playback.chooseMount
import com.maroonedsoftware.deadair.playout.PlayoutState
import com.maroonedsoftware.deadair.settings.ListenerSettings
import com.maroonedsoftware.deadair.ui.rememberNowEpochMs
import com.maroonedsoftware.deadair.ui.history.HistoryScreen
import com.maroonedsoftware.deadair.ui.order.OrderHandlers
import com.maroonedsoftware.deadair.ui.order.RunningOrderUiState
import com.maroonedsoftware.deadair.director.OrderState
import com.maroonedsoftware.deadair.sdk.models.StationOrderItemKind
import com.maroonedsoftware.deadair.ui.order.RunningOrderScreen
import com.maroonedsoftware.deadair.ui.nowplaying.NowPlayingScreen
import com.maroonedsoftware.deadair.ui.nowplaying.NowPlayingUiState
import com.maroonedsoftware.deadair.ui.nowplaying.TransportHandlers
import com.maroonedsoftware.deadair.ui.nowplaying.TransportUiState
import com.maroonedsoftware.deadair.ui.nowplaying.rememberPlayWithNotificationsAsked
import com.maroonedsoftware.deadair.ui.nowplaying.readSilence
import com.maroonedsoftware.deadair.ui.nowplaying.rememberPlayhead
import com.maroonedsoftware.deadair.sdk.models.Rating
import com.maroonedsoftware.deadair.ui.schedule.WhatsOnScreen
import com.maroonedsoftware.deadair.ui.text.Message
import com.maroonedsoftware.deadair.ui.text.resolve
import kotlinx.coroutines.launch

/**
 * The tabbed screen, wired.
 *
 * What the `Home` destination puts on screen: the frame, the tab that is selected, and the tab's
 * own reading of whichever repository it draws from. The now-playing reading and the player
 * connection arrive from above rather than being made here, because Settings needs the first (the
 * format picker reads the station's `mounts[]` from it) and the second must outlive a trip to
 * Settings and back; the schedule and history polls are this screen's alone and stop when it goes.
 */
@Composable
fun HomeRoute(
    graph: AppGraph,
    settings: ListenerSettings,
    nowPlaying: NowPlayingState,
    playback: PlayerUiState,
    connection: PlayerConnection,
    onSettings: () -> Unit,
) {
    // Survives a rotation, which `remember` alone would not, and a trip to Settings and back,
    // which the display's saveable-state decorator sees to.
    var tab by rememberSaveable { mutableStateOf(Tab.NOW_PLAYING) }

    // Back returns to the tab this app opens on before it leaves, which is what an Android
    // listener expects of a bottom bar. The display handles back for the stack above this; this
    // only fires when this is the only entry.
    BackHandler(enabled = tab != Tab.NOW_PLAYING) { tab = Tab.NOW_PLAYING }

    // Collected here so the polls run while their tabs can be seen. They stop on their own when not.
    val schedule by graph.schedule.state.collectAsStateWithLifecycle()
    val history by graph.history.state.collectAsStateWithLifecycle()
    val nowEpochMs by rememberNowEpochMs()
    val scope = rememberCoroutineScope()
    val session by graph.sessions.state.collectAsStateWithLifecycle()
    val isOperator = (session as? SessionState.SignedIn)?.isOperator == true

    // What an operator action came back with, said once. Collected into state and resolved in
    // composition, because the words live in resources and a snackbar wants a string.
    val snackbarHost = remember { SnackbarHostState() }
    var notice by remember { mutableStateOf<Notice?>(null) }
    LaunchedEffect(Unit) { graph.operator.notices.collect { notice = it } }
    notice?.let { current ->
        val words = Message.OperatorNotice(current).resolve()
        LaunchedEffect(current) {
            snackbarHost.showSnackbar(words)
            if (notice == current) notice = null
        }
    }

    val station = settings.station
    val reading =
        when (val current = nowPlaying) {
            is NowPlayingState.Answered -> current.reading
            is NowPlayingState.Unreachable -> current.lastGood
            NowPlayingState.Loading -> null
        }
    val air = airState(nowPlaying, playback.requested)
    val choice = chooseMount(reading?.nowPlaying?.mounts.orEmpty(), settings.format)
    val play = rememberPlayWithNotificationsAsked(connection::play)

    // The order's own state is read here as well as in its tab, because the app bar's Extend and
    // Shuffle live above the tab and need to know whether there is anything to shuffle. Collected
    // only while the tab is showing, so the poll still stops when it is left.
    val order by if (tab == Tab.UP_NEXT) graph.order.state.collectAsStateWithLifecycle() else remember { mutableStateOf<OrderState>(OrderState.Loading) }
    var orderBusy by remember { mutableStateOf(false) }
    var busyItemId by remember { mutableStateOf<String?>(null) }
    fun orderAction(itemId: String? = null, action: suspend () -> Unit) {
        if (orderBusy) return
        orderBusy = true
        busyItemId = itemId
        scope.launch {
            try {
                action()
            } finally {
                orderBusy = false
                busyItemId = null
            }
        }
    }
    val refillAsked = stringResource(R.string.refill_asked)
    val dropped = stringResource(R.string.dropped)
    val putItBack = stringResource(R.string.put_it_back)

    HomeScreen(
        // What the station calls itself now, else what it called itself when it was kept, else
        // the address — which a listener should see only in the moments before either exists.
        station = reading?.nowPlaying?.station ?: settings.stationName ?: station?.origin.orEmpty(),
        tab = tab,
        onTab = { tab = it },
        onSettings = onSettings,
        snackbarHost = snackbarHost,
        actions = {
            val loaded = order as? OrderState.Loaded
            if (tab == Tab.UP_NEXT && isOperator && loaded != null) {
                IconButton(
                    onClick = { orderAction { if (graph.orderActions.extend()) snackbarHost.showSnackbar(refillAsked) } },
                    enabled = !orderBusy,
                ) {
                    Icon(painterResource(R.drawable.ic_playlist_add), contentDescription = stringResource(R.string.extend))
                }
                // Nothing to shuffle with fewer than two rows the player has not been handed.
                IconButton(
                    onClick = { orderAction { graph.orderActions.shuffle() } },
                    enabled = !orderBusy && RunningOrderUiState(loaded.order.items).plannedCount >= 2,
                ) {
                    Icon(painterResource(R.drawable.ic_shuffle), contentDescription = stringResource(R.string.shuffle))
                }
            }
        },
    ) {
        when (tab) {
            Tab.NOW_PLAYING -> {
                // Collected inside this branch and nowhere else, so the two-second transport poll
                // runs while this tab is up and stops a few seconds after it is left.
                val playout by graph.playout.state.collectAsStateWithLifecycle()
                val loaded = playout as? PlayoutState.Loaded
                val silence = loaded?.status?.silence?.let(::readSilence)

                // One action at a time, so a second press waits for the first rather than queueing
                // behind it: two skips in flight would take two records off air.
                var busy by remember { mutableStateOf(false) }
                fun act(action: suspend () -> Unit) {
                    if (busy) return
                    busy = true
                    scope.launch {
                        try {
                            action()
                        } finally {
                            busy = false
                        }
                    }
                }
                val transport = if (isOperator && loaded != null) TransportUiState(status = loaded.status, air = loaded.air, busy = busy) else null
                val handlers =
                    remember(graph) {
                        TransportHandlers(
                            onSkip = { act { graph.transport.skip() } },
                            onStop = { act { graph.transport.stop() } },
                            onStart = { act { graph.transport.start() } },
                            onHold = { minutes -> act { graph.transport.hold(minutes) } },
                            onRelease = { act { graph.transport.release() } },
                            onAirMode = { mode -> act { graph.transport.setAirMode(mode) } },
                        )
                    }
                NowPlayingScreen(
                    state =
                        NowPlayingUiState(
                            air = air,
                            listeners = reading?.nowPlaying?.listeners ?: 0,
                            format = settings.format,
                            playing = playback.requested,
                            buffering = playback.buffering,
                            // Only worth saying while something is actually playing; before that
                            // it is a guess about a station that has not answered yet.
                            fellBackToMp3 = choice.fellBack && playback.requested,
                            stale = nowPlaying is NowPlayingState.Unreachable,
                        ),
                    artworkUrl = station?.artUrl(reading?.nowPlaying?.track?.artworkUrl),
                    // Frozen while the station is unreachable: a bar still sweeping from a reading
                    // minutes old is a moving, confident lie about where the record is.
                    playhead = rememberPlayhead(reading.takeIf { nowPlaying is NowPlayingState.Answered }),
                    onPlay = play,
                    onStop = connection::stop,
                    onOpenFormat = onSettings,
                    silence = silence,
                    transport = transport,
                    handlers = handlers,
                )
            }
            Tab.UP_NEXT -> {
                var ratingTrackId by remember { mutableStateOf<String?>(null) }
                val handlers =
                    if (!isOperator) {
                        null
                    } else {
                        OrderHandlers(
                            onRate = { trackId: String, rating: Rating ->
                                if (ratingTrackId == null) {
                                    ratingTrackId = trackId
                                    scope.launch {
                                        try {
                                            graph.catalog.rateTrack(trackId, rating)
                                        } finally {
                                            ratingTrackId = null
                                        }
                                    }
                                }
                            },
                            ratingTrackId = ratingTrackId,
                            onMove = { itemId, toIndex -> orderAction(itemId) { graph.orderActions.move(itemId, toIndex) } },
                            onRemove = { item, atIndex ->
                                orderAction(item.id) {
                                    if (!graph.orderActions.remove(item.id)) return@orderAction
                                    // Only a record can be put back: a break is marked removed rather
                                    // than spliced out, so there is nothing to put back. The index is
                                    // the one the row held at the tap, and the station may refuse it
                                    // if the player has passed it since — that comes back as a notice.
                                    val trackId = item.trackId?.takeIf { item.kind == StationOrderItemKind.TRACK } ?: return@orderAction
                                    val answer = snackbarHost.showSnackbar(message = dropped.format(item.title), actionLabel = putItBack, duration = SnackbarDuration.Long)
                                    if (answer == SnackbarResult.ActionPerformed) graph.orderActions.restore(trackId, atIndex)
                                }
                            },
                            busyItemId = busyItemId,
                        )
                    }
                RunningOrderScreen(
                    state = order,
                    artUrlFor = { url -> station?.artUrl(url) },
                    onRetry = graph.order::retry,
                    onSettings = onSettings,
                    handlers = handlers,
                )
            }
            Tab.HISTORY ->
                HistoryScreen(
                    state = history,
                    artUrlFor = { url -> station?.artUrl(url) },
                    nowEpochMs = nowEpochMs,
                    scope = scope,
                    onLoadMore = graph.history::loadMore,
                    onRetry = graph.history::retry,
                    onSettings = onSettings,
                )
            Tab.WHATS_ON -> WhatsOnScreen(state = schedule, onRetry = graph.schedule::retry, onSettings = onSettings)
        }
    }
}
