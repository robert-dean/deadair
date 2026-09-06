package com.maroonedsoftware.deadair.ui.home

import androidx.activity.compose.BackHandler
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maroonedsoftware.deadair.AppGraph
import com.maroonedsoftware.deadair.nowplaying.NowPlayingState
import com.maroonedsoftware.deadair.nowplaying.airState
import com.maroonedsoftware.deadair.playback.PlayerConnection
import com.maroonedsoftware.deadair.playback.PlayerUiState
import com.maroonedsoftware.deadair.playback.chooseMount
import com.maroonedsoftware.deadair.settings.ListenerSettings
import com.maroonedsoftware.deadair.ui.history.HistoryScreen
import com.maroonedsoftware.deadair.ui.nowplaying.NowPlayingScreen
import com.maroonedsoftware.deadair.ui.nowplaying.NowPlayingUiState
import com.maroonedsoftware.deadair.ui.nowplaying.rememberPlayhead
import com.maroonedsoftware.deadair.ui.schedule.WhatsOnScreen

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
    val scope = rememberCoroutineScope()

    val station = settings.station
    val reading =
        when (val current = nowPlaying) {
            is NowPlayingState.Answered -> current.reading
            is NowPlayingState.Unreachable -> current.lastGood
            NowPlayingState.Loading -> null
        }
    val air = airState(nowPlaying, playback.requested)
    val choice = chooseMount(reading?.nowPlaying?.mounts.orEmpty(), settings.format)

    HomeScreen(
        station = reading?.nowPlaying?.station ?: station?.origin.orEmpty(),
        tab = tab,
        onTab = { tab = it },
        onSettings = onSettings,
    ) {
        when (tab) {
            Tab.NOW_PLAYING ->
                NowPlayingScreen(
                    state =
                        NowPlayingUiState(
                            station = reading?.nowPlaying?.station ?: station?.origin.orEmpty(),
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
                    onPlay = connection::play,
                    onStop = connection::stop,
                )
            Tab.HISTORY ->
                HistoryScreen(
                    state = history,
                    artUrlFor = { url -> station?.artUrl(url) },
                    // Read once per recomposition rather than ticked: these are timestamps on
                    // things that have already happened, so nothing about them moves.
                    nowEpochMs = System.currentTimeMillis(),
                    scope = scope,
                    onLoadMore = graph.history::loadMore,
                    onSettings = onSettings,
                )
            Tab.WHATS_ON -> WhatsOnScreen(state = schedule, onSettings = onSettings)
        }
    }
}
