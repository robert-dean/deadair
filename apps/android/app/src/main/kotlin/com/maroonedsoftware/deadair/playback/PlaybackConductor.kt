package com.maroonedsoftware.deadair.playback

import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import com.maroonedsoftware.deadair.AppGraph
import com.maroonedsoftware.deadair.nowplaying.NowPlayingState
import com.maroonedsoftware.deadair.sdk.models.NowPlaying
import com.maroonedsoftware.deadair.sdk.models.NowPlayingMount
import com.maroonedsoftware.deadair.station.StationUrl
import com.maroonedsoftware.deadair.station.StreamFormat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch

/**
 * Keeps the player pointed at the right mount, and its metadata current.
 *
 * Everything here runs on the main looper, because that is where a `Player` must be touched.
 */
class PlaybackConductor(private val player: Player, private val graph: AppGraph, private val offAir: String) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val handler = Handler(Looper.getMainLooper())
    private val backoff = Backoff()

    private var station: StationUrl? = null
    private var format: StreamFormat = StreamFormat.MP3
    private var mounts: List<NowPlayingMount> = emptyList()
    private var current: MountChoice? = null
    /** What was on air when the metadata was last pushed, so an unchanged track is not re-pushed. */
    private var pushedFor: Long? = null

    private val listener =
        object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                retryLater()
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                // A stream that is playing has earned a fresh budget: the next failure should wait
                // a second, not the half-minute the last outage ended on.
                if (playbackState == Player.STATE_READY) backoff.reset()
            }
        }

    fun start() {
        player.addListener(listener)

        // The settings and the station's own answer are read together, because the mount to play
        // is a function of both: which format the listener chose, and which paths the station says
        // it publishes.
        combine(graph.settings.settings, graph.nowPlaying.state) { settings, state -> settings to state }
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
        player.removeListener(listener)
        handler.removeCallbacksAndMessages(null)
        scope.cancel()
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

    /** Try the stream again after a wait, for as long as that is worth doing. */
    private fun retryLater() {
        if (!player.playWhenReady) return
        val wait = backoff.next() ?: return
        handler.postDelayed(
            {
                if (player.playWhenReady) {
                    player.prepare()
                    player.play()
                }
            },
            wait,
        )
    }
}
