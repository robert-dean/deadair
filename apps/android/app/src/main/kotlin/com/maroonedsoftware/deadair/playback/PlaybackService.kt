package com.maroonedsoftware.deadair.playback

import android.content.Intent
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.session.CacheBitmapLoader
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import com.maroonedsoftware.deadair.DeadairApp
import com.maroonedsoftware.deadair.MainActivity
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.net.HttpClients
import android.app.PendingIntent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * The station, playing, with the app in the background.
 *
 * A `MediaSessionService` rather than a player owned by the screen, because listening to the radio
 * is exactly the thing somebody does while looking at something else. The session is also what
 * puts the controls on the lock screen and answers a Bluetooth head unit.
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null
    private var conductor: PlaybackConductor? = null

    /** The main looper, because everything here touches a `Player`. Cancelled with the service. */
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onCreate() {
        super.onCreate()
        val graph = (application as DeadairApp).graph
        setMediaNotificationProvider(LiveNotificationProvider(this))

        // One HTTP factory for the stream and for the artwork the session fetches for the lock
        // screen, so both carry the app's agent. The session's default loader used the platform's
        // own stack and its own agent, which to a station counting listeners by agent was a second
        // listener appearing for one request each time the record changed.
        val http =
            DefaultHttpDataSource.Factory()
                // The same agent the API and the artwork use. HLS listeners are counted per IP and
                // agent, so this is what makes one listener count as one.
                .setUserAgent(HttpClients.USER_AGENT)
                // `/live.m3u8` is a 302 to `/hls/live.m3u8`. Same protocol at the station's own
                // edge, but a tunnel in front may not be.
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(CONNECT_TIMEOUT_MS)
                .setReadTimeoutMs(READ_TIMEOUT_MS)

        val player =
            ExoPlayer.Builder(this)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(C.USAGE_MEDIA)
                        .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                        .build(),
                    // Duck for a navigation prompt, pause for a call. Handled by the player rather
                    // than by this app, which gets the platform's behaviour rather than an
                    // approximation of it.
                    true,
                )
                // Unplugging headphones stops the stream. Without this the station keeps playing
                // out of the phone's speaker in somebody's pocket.
                .setHandleAudioBecomingNoisy(true)
                // Holds a wake lock and a wifi lock while playing, which is what stops a dozing
                // phone from tearing down the connection mid-record.
                .setWakeMode(C.WAKE_MODE_NETWORK)
                .setMediaSourceFactory(DefaultMediaSourceFactory(http))
                .build()

        val live = LivePlayer(player)
        session =
            MediaSession.Builder(this, live)
                .setSessionActivity(
                    PendingIntent.getActivity(
                        this,
                        0,
                        Intent(this, MainActivity::class.java),
                        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                    ),
                )
                .setCallback(Resumption())
                // Cached, because the session asks for the same picture every time the metadata
                // is pushed, and the metadata is pushed every time the record changes. Bounded,
                // because a cover is decoded into a bitmap in this process and `/api/art` can
                // answer with the full-size original.
                .setBitmapLoader(
                    CacheBitmapLoader(
                        DataSourceBitmapLoader.Builder(this)
                            .setDataSourceFactory(http)
                            .setMaximumOutputDimension(ARTWORK_MAX_SIDE)
                            .build(),
                    ),
                )
                .build()

        conductor = PlaybackConductor(live, graph, offAir = getString(R.string.now_off_air)).also { it.start() }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    /**
     * What a media button reaches when nothing is playing and the app is not running.
     *
     * Getting into a car and pressing play on the wheel is the moment somebody most wants a radio,
     * and it is exactly when this app is least likely to be running: the service stops itself when
     * the task is swiped away and nothing is coming out of it. Without this the press reached a
     * dead session and the listener had to unlock the phone and open the app, which is the opposite
     * of what a background player is for.
     *
     * There is no position and no queue to restore, which makes this the easy version of a problem
     * most players find hard: the answer is the mount, at zero.
     */
    private inner class Resumption : MediaSession.Callback {
        override fun onPlaybackResumption(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            val answer = SettableFuture.create<MediaSession.MediaItemsWithStartPosition>()
            scope.launch {
                val item = conductor?.resumptionItem()
                if (item == null) {
                    // No station has ever been kept, so there is nothing this app could play.
                    // Refusing leaves the button alone rather than starting a silent service.
                    answer.setException(UnsupportedOperationException("This install has no station"))
                } else {
                    answer.set(MediaSession.MediaItemsWithStartPosition(listOf(item), 0, 0L))
                }
            }
            return answer
        }
    }

    /**
     * Swiping the app away stops the station unless it is actually playing.
     *
     * A service left running with nothing coming out of it is a notification the listener cannot
     * get rid of; one left running WHILE playing is the whole point of a background player.
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        val player = session?.player
        if (player == null || !player.playWhenReady) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        scope.cancel()
        conductor?.stop()
        conductor = null
        session?.run {
            player.release()
            release()
        }
        session = null
        super.onDestroy()
    }

    private companion object {
        const val CONNECT_TIMEOUT_MS = 8_000
        const val READ_TIMEOUT_MS = 15_000

        /** A lock screen shows a cover at a few hundred pixels a side; 1024 is generous and keeps a decoded cover to a few megabytes. */
        const val ARTWORK_MAX_SIDE = 1024
    }
}
