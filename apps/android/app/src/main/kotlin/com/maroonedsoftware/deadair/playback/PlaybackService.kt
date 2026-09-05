package com.maroonedsoftware.deadair.playback

import android.content.Intent
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.maroonedsoftware.deadair.DeadairApp
import com.maroonedsoftware.deadair.MainActivity
import com.maroonedsoftware.deadair.net.HttpClients
import android.app.PendingIntent

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

    override fun onCreate() {
        super.onCreate()
        val graph = (application as DeadairApp).graph

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
                .setMediaSourceFactory(
                    DefaultMediaSourceFactory(
                        DefaultHttpDataSource.Factory()
                            // The same agent the API and the artwork use. HLS listeners are counted
                            // per IP and agent, so this is what makes one listener count as one.
                            .setUserAgent(HttpClients.USER_AGENT)
                            // `/live.m3u8` is a 302 to `/hls/live.m3u8`. Same protocol at the
                            // station's own edge, but a tunnel in front may not be.
                            .setAllowCrossProtocolRedirects(true)
                            .setConnectTimeoutMs(CONNECT_TIMEOUT_MS)
                            .setReadTimeoutMs(READ_TIMEOUT_MS),
                    ),
                )
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
                .build()

        conductor = PlaybackConductor(live, graph).also { it.start() }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

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
    }
}
