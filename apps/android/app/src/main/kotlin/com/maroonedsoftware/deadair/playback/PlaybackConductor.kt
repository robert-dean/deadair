package com.maroonedsoftware.deadair.playback

import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import com.maroonedsoftware.deadair.AppGraph
import com.maroonedsoftware.deadair.nowplaying.NowPlayingState
import com.maroonedsoftware.deadair.sdk.models.NowPlaying
import com.maroonedsoftware.deadair.sdk.models.NowPlayingMount
import com.maroonedsoftware.deadair.station.StationUrl
import com.maroonedsoftware.deadair.station.StreamFormat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch

/**
 * Keeps the player pointed at the right mount, and its metadata current.
 *
 * Everything here runs on the main looper, because that is where a `Player` must be touched.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PlaybackConductor(private val player: Player, private val graph: AppGraph, private val offAir: String) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val handler = Handler(Looper.getMainLooper())
    private val policy =
        ReconnectPolicy(
            backoff = Backoff(),
            schedule = { ms, run ->
                val r = Runnable(run)
                handler.postDelayed(r, ms)
                { handler.removeCallbacks(r) }
            },
            wantsPlay = { player.playWhenReady },
            reconnect = {
                player.prepare()
                player.play()
            },
            stop = { player.stop() },
        )
    /**
     * Mirrors `player.playWhenReady`, so the poll below can be gated on it. A separate listener
     * rather than a hook on `policy`: `ReconnectPolicy` is pure reconnect decision-making and
     * knows nothing of the poll it happens to run beside.
     */
    private val playWhenReady = MutableStateFlow(player.playWhenReady)
    private val playWhenReadyListener =
        object : Player.Listener {
            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                this@PlaybackConductor.playWhenReady.value = playWhenReady
            }
        }

    private var station: StationUrl? = null
    private var format: StreamFormat = StreamFormat.MP3
    private var mounts: List<NowPlayingMount> = emptyList()
    private var current: MountChoice? = null
    /** What was on air when the metadata was last pushed, so an unchanged track is not re-pushed. */
    private var pushedFor: Long? = null

    fun start() {
        player.addListener(policy)
        player.addListener(playWhenReadyListener)

        // The settings and the station's own answer are read together, because the mount to play
        // is a function of both: which format the listener chose, and which paths the station says
        // it publishes. Collected only while `playWhenReady`: `NowPlayingRepository.state` is
        // `WhileSubscribed`, so a stopped player (nobody listening) lets that poll stop too, rather
        // than this subscription holding it open for the service's whole life.
        playWhenReady
            .flatMapLatest { isPlaying ->
                if (isPlaying) {
                    combine(graph.settings.settings, graph.nowPlaying.state) { settings, state -> settings to state }
                } else {
                    emptyFlow()
                }
            }
            .onEach { (settings, state) ->
                station = settings.station
                format = settings.format
                val now = state.nowPlaying()
                if (now != null) mounts = now.mounts

                retarget()
                pushMetadata(now)
            }
            .launchIn(scope)
    }

    fun stop() {
        player.removeListener(policy)
        player.removeListener(playWhenReadyListener)
        policy.cancel()
        handler.removeCallbacksAndMessages(null)
        scope.cancel()
    }

    /**
     * The item a media button should resume on.
     *
     * Pressed from a steering wheel with the app long since swiped away, so nothing here may wait
     * on the poll: the station has not been asked anything yet and the answer is wanted now. What
     * a live stream needs is one item at position zero, and `chooseMount` already knows what to do
     * with no mounts — it answers the station's default and says it fell back. If the poll then
     * names a different path the collector above moves to it a moment later, which is why `current`
     * is recorded here: so that move does NOT happen when the guess was right, and the stream is
     * not restarted a second after it started.
     *
     * `null` when no station has ever been kept, which is an install that has nothing to play.
     */
    suspend fun resumptionItem(): MediaItem? {
        val settings = graph.settings.settings.first()
        val where = settings.station ?: return null

        station = where
        format = settings.format
        val choice = chooseMount(mounts, settings.format)
        current = choice
        pushedFor = null
        return MediaItems.forMount(where, choice, MediaItems.metadataFor(where, null, offAir))
    }

    private fun NowPlayingState.nowPlaying(): NowPlaying? =
        when (this) {
            is NowPlayingState.Answered -> reading.nowPlaying
            is NowPlayingState.Unreachable -> lastGood?.nowPlaying
            NowPlayingState.Loading -> null
        }

    /**
     * Point the player at the mount the settings and the station now agree on.
     *
     * Only when it actually changed: rebuilding the item on every poll would restart the stream
     * every three seconds. A change of format, or a station that has just told us the real path
     * for the first time, is what moves it.
     */
    private fun retarget() {
        val where = station ?: return
        val choice = chooseMount(mounts, format)
        if (choice == current) return

        val wasPlaying = player.playWhenReady
        current = choice
        pushedFor = null
        policy.cancel()
        player.setMediaItem(MediaItems.forMount(where, choice, MediaItems.metadataFor(where, null, offAir)))
        if (wasPlaying) {
            player.prepare()
            player.play()
        }
    }

    /**
     * Put what is on air onto the lock screen.
     *
     * Through `replaceMediaItem` with the same URI and only the metadata changed, which the media
     * sources treat as an update rather than as a new stream, so the audio is not interrupted.
     * Pushed only when the TRACK changed — compared on `startedAt`, which is what identifies one —
     * rather than on every poll, because three-second churn on a lock screen is visible.
     */
    private fun pushMetadata(now: NowPlaying?) {
        val where = station ?: return
        val item = player.currentMediaItem ?: return
        val startedAt = now?.track?.startedAt
        if (startedAt == pushedFor && now?.track != null) return

        pushedFor = startedAt
        player.replaceMediaItem(0, item.buildUpon().setMediaMetadata(MediaItems.metadataFor(where, now, offAir)).build())
    }
}
