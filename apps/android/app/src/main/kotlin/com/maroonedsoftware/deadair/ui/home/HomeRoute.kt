package com.maroonedsoftware.deadair.ui.home

import androidx.activity.compose.BackHandler
import androidx.compose.runtime.Composable
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.IconButton
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import com.maroonedsoftware.deadair.R
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maroonedsoftware.deadair.AppGraph
import com.maroonedsoftware.deadair.auth.Notice
import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.nowplaying.NowPlayingState
import com.maroonedsoftware.deadair.nowplaying.airState
import com.maroonedsoftware.deadair.playback.PlayerConnection
import com.maroonedsoftware.deadair.playback.PlayerUiState
import com.maroonedsoftware.deadair.playout.PlayoutState
import com.maroonedsoftware.deadair.settings.ListenerSettings
import com.maroonedsoftware.deadair.ui.ShowOperatorNotices
import com.maroonedsoftware.deadair.ui.LoadState
import com.maroonedsoftware.deadair.ui.catalog.rememberDetail
import com.maroonedsoftware.deadair.ui.order.BroadcastUiState
import com.maroonedsoftware.deadair.ui.order.OrderHandlers
import com.maroonedsoftware.deadair.ui.order.OrderVerb
import com.maroonedsoftware.deadair.ui.order.orderMenu
import com.maroonedsoftware.deadair.director.OrderState
import com.maroonedsoftware.deadair.sdk.models.StationOrderItemKind
import com.maroonedsoftware.deadair.ui.order.RunningOrderScreen
import com.maroonedsoftware.deadair.ui.nowplaying.NowPlayingScreen
import com.maroonedsoftware.deadair.ui.nowplaying.NowPlayingUiState
import com.maroonedsoftware.deadair.ui.nowplaying.SkipControl
import com.maroonedsoftware.deadair.ui.nowplaying.rememberRest
import com.maroonedsoftware.deadair.ui.nowplaying.sideBySide
import com.maroonedsoftware.deadair.ui.nowplaying.TransportUiState
import com.maroonedsoftware.deadair.ui.nowplaying.rememberPlayWithNotificationsAsked
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
 * Settings and back; the schedule poll is this screen's alone and stops when it goes.
 */
@Composable
fun HomeRoute(
    graph: AppGraph,
    settings: ListenerSettings,
    nowPlaying: NowPlayingState,
    playback: PlayerUiState,
    connection: PlayerConnection,
    /** Which tab is showing. Held above, so a pushed page's Sign in can land on Settings. */
    tab: Tab,
    onTab: (Tab) -> Unit,
    /** The Settings tab's content. Drawn from above, where the settings' own model lives. */
    settingsTab: @Composable () -> Unit,
    /** Open a record's page. */
    onTrack: (String) -> Unit,
    /** Open the desk: everything that can take the station off air. Offered to the operator only. */
    onDesk: () -> Unit,
    /** Open the list of what could be put on air. Offered to the operator only. */
    onAirSomething: () -> Unit,
    /** Open the library search, to add one record. Offered to the operator only, while something is on. */
    onAddRecord: () -> Unit,
    /** Open the sign-in page, over this screen, which is where it comes back to. */
    onSignIn: () -> Unit,
    /** Open everything the station has played. */
    onHistory: () -> Unit,
    /** Open what the station said: everything, or one break's attempts. */
    onScripts: (segmentId: String?) -> Unit,
    /** Change what the station plays. The broadcast rides along, so the form opens on a fixed baseline. */
    onPlan: (currentBrief: String?, somethingOn: Boolean) -> Unit,
) {
    // Back returns to the tab this app opens on before it leaves, which is what an Android
    // listener expects of a bottom bar. The display handles back for the stack above this; this
    // only fires when this is the only entry.
    BackHandler(enabled = tab != Tab.NOW_PLAYING) { onTab(Tab.NOW_PLAYING) }

    // Collected here so the polls run while their tabs can be seen. They stop on their own when not.
    val schedule by graph.schedule.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val session by graph.sessions.state.collectAsStateWithLifecycle()
    val isOperator = (session as? SessionState.SignedIn)?.isOperator == true

    val snackbarHost = remember { SnackbarHostState() }
    ShowOperatorNotices(graph.operator.notices, snackbarHost)

    val station = settings.station
    val reading =
        when (val current = nowPlaying) {
            is NowPlayingState.Answered -> current.reading
            is NowPlayingState.Unreachable -> current.lastGood
            NowPlayingState.Loading -> null
        }
    val air = airState(nowPlaying, playback.requested)
    val play = rememberPlayWithNotificationsAsked(connection::play)
    // One state for Now playing and the player bar over the other tabs, so the two cannot disagree
    // about what is on.
    val nowState =
        NowPlayingUiState(
            air = air,
            playing = playback.requested,
            buffering = playback.buffering,
            stale = nowPlaying is NowPlayingState.Unreachable,
            show = reading?.nowPlaying?.show,
        )
    val artworkUrl = station?.artUrl(reading?.nowPlaying?.track?.artworkUrl)

    // Now playing gives the screen to the cover when left alone, upright only: sideways the cover
    // is beside the words and already has its own half. Held here because the tabs go with it.
    val window = LocalWindowInfo.current.containerSize
    val upright = with(LocalDensity.current) { !sideBySide(window.width.toDp(), window.height.toDp()) }
    val rest = rememberRest(allowed = tab == Tab.NOW_PLAYING && upright && nowState.canRest)

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
        title =
            if (tab == Tab.SETTINGS) {
                stringResource(R.string.settings)
            } else {
                reading?.nowPlaying?.station ?: settings.stationName ?: station?.origin.orEmpty()
            },
        tab = tab,
        onTab = onTab,
        // Now playing is the cover to the top of the screen, and a bar over it would be the one
        // thing on the art that is not the art.
        topBar = tab != Tab.NOW_PLAYING,
        bottomBar = !rest.resting,
        snackbarHost = snackbarHost,
        // Over the tabs that are about the station, and not over Now playing, which has the
        // station's button already, or Settings, which is not about what is on.
        miniPlayer =
            if (tab == Tab.NOW_PLAYING || tab == Tab.SETTINGS) {
                null
            } else {
                { MiniPlayer(nowState, artworkUrl, onOpen = { onTab(Tab.NOW_PLAYING) }, onPlay = play, onStop = connection::stop) }
            },
        actions = {
            val loaded = order as? OrderState.Loaded
            // What it said is a read, so any signed-in listener gets it; the rest are the operator's.
            if (tab == Tab.UP_NEXT && session is SessionState.SignedIn) {
                IconButton(onClick = { onScripts(null) }) {
                    Icon(painterResource(R.drawable.ic_record_voice_over), contentDescription = stringResource(R.string.what_it_said))
                }
            }
            // The operator's verbs behind one overflow, each in words. See `orderMenu`.
            if (tab == Tab.UP_NEXT && isOperator) {
                var open by remember { mutableStateOf(false) }
                Box {
                    IconButton(onClick = { open = true }) {
                        Icon(painterResource(R.drawable.ic_more_vert), contentDescription = stringResource(R.string.more_actions))
                    }
                    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                        orderMenu(loaded?.order, busy = orderBusy).forEach { item ->
                            DropdownMenuItem(
                                text = { Text(stringResource(item.verb.label)) },
                                enabled = item.enabled,
                                onClick = {
                                    open = false
                                    when (item.verb) {
                                        OrderVerb.DESK -> onDesk()
                                        OrderVerb.AIR_SOMETHING -> onAirSomething()
                                        OrderVerb.ADD_RECORD -> onAddRecord()
                                        OrderVerb.REFILL -> orderAction { if (graph.orderActions.extend()) snackbarHost.showSnackbar(refillAsked) }
                                        OrderVerb.SHUFFLE -> orderAction { graph.orderActions.shuffle() }
                                    }
                                },
                            )
                        }
                    }
                }
            }
        },
    ) {
        when (tab) {
            Tab.NOW_PLAYING -> {
                // Collected inside this branch and nowhere else, so the two-second transport poll
                // runs while this tab is up and stops a few seconds after it is left. It is what
                // says whether there is anything to skip, and which record the cover is.
                val playout by graph.playout.state.collectAsStateWithLifecycle()
                val loaded = playout as? PlayoutState.Loaded

                // One skip at a time: two in flight would take two records off air.
                var busy by remember { mutableStateOf(false) }
                val skip =
                    if (isOperator && loaded != null) {
                        SkipControl(enabled = TransportUiState(status = loaded.status, air = loaded.air, busy = busy).skipEnabled) {
                            if (!busy) {
                                busy = true
                                scope.launch {
                                    try {
                                        graph.transport.skip()
                                    } finally {
                                        busy = false
                                    }
                                }
                            }
                        }
                    } else {
                        null
                    }
                NowPlayingScreen(
                    state = nowState,
                    artworkUrl = artworkUrl,
                    // Frozen while the station is unreachable: a bar still sweeping from a reading
                    // minutes old is a moving, confident lie about where the record is.
                    playhead = rememberPlayhead(reading.takeIf { nowPlaying is NowPlayingState.Answered }),
                    onPlay = play,
                    onStop = connection::stop,
                    skip = skip,
                    // The cover leads to the record's page, for a signed-in listener: the public
                    // reading names no record, so only the transport reading can say which it is.
                    onArtwork = loaded?.status?.nowPlaying?.item?.trackId?.let { id -> { onTrack(id) } },
                    rest = rest,
                )
            }
            Tab.UP_NEXT -> {
                // One read when the tab opens rather than a poll: the station's characters change
                // when somebody edits one, not on a clock, and this is a `platform.view` read that
                // a listener is allowed to make even though only an operator can act on it.
                val personas = rememberDetail("personas") { graph.sessions.withSession { it.personas.listPersonas().personas } }
                val loadedOrder = (order as? OrderState.Loaded)?.order
                val broadcast = loadedOrder?.let { BroadcastUiState(it, (personas.state as? LoadState.Loaded)?.value) }

                val handlers =
                    if (!isOperator) {
                        null
                    } else {
                        OrderHandlers(
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
                            onRecast = { personaId -> orderAction { graph.orderActions.recast(personaId) } },
                            onPlan = { onPlan(loadedOrder?.brief, broadcast?.nothingOn == false) },
                            busy = orderBusy,
                        )
                    }
                RunningOrderScreen(
                    state = order,
                    artUrlFor = { url -> station?.artUrl(url) },
                    onRetry = graph.order::retry,
                    onSignIn = onSignIn,
                    onTrack = onTrack,
                    onSegment = { segmentId -> onScripts(segmentId) },
                    onHistory = onHistory,
                    broadcast = broadcast,
                    personas = personas.state,
                    onReloadPersonas = personas::reload,
                    handlers = handlers,
                )
            }
            Tab.WHATS_ON -> WhatsOnScreen(state = schedule, onRetry = graph.schedule::retry, onSignIn = onSignIn)
            Tab.SETTINGS -> settingsTab()
        }
    }
}

/** What each verb is called in the overflow. */
private val OrderVerb.label: Int
    get() =
        when (this) {
            OrderVerb.DESK -> R.string.desk
            OrderVerb.AIR_SOMETHING -> R.string.menu_air_something
            OrderVerb.ADD_RECORD -> R.string.menu_add_a_record
            OrderVerb.REFILL -> R.string.menu_refill
            OrderVerb.SHUFFLE -> R.string.menu_shuffle
        }
