package com.maroonedsoftware.deadair.playback

import android.content.Intent
import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.session.CacheBitmapLoader
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import com.maroonedsoftware.deadair.DeadairApp
import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.MainActivity
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.net.HttpClients
import android.app.PendingIntent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * The station, playing, with the app in the background.
 *
 * A service rather than a player owned by the screen, because listening to the radio is exactly the
 * thing somebody does while looking at something else. The session is also what puts the controls on
 * the lock screen and answers a Bluetooth head unit.
 *
 * A LIBRARY service, so Android Auto can list the station and a car can start it: the library is one
 * folder holding the station and nothing else. Everything that is not a car (the screen, the lock
 * screen, a headset) sees exactly the session it always did.
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaLibraryService() {
    private var session: MediaLibrarySession? = null
    private var conductor: PlaybackConductor? = null
    private var live: LivePlayer? = null

    /** Whether the task was swiped away while the station played on. */
    private var taskGone = false

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
                // Asks Icecast to interleave the track title into the audio itself, which is what
                // lets the conductor's gate drive the notification off the audio's own schedule
                // instead of the poll's. Harmless on the artwork requests this factory also serves:
                // `/api/art` ignores a header it does not understand.
                .setDefaultRequestProperties(mapOf("Icy-MetaData" to "1"))

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

        val live =
            LivePlayer(player) {
                // The same call the on-screen Skip makes, and refused in the same way. A 403
                // re-reads the roles, which takes the button off the head unit through the
                // collector below; the notice it also raises is seen only if a screen is up.
                scope.launch { graph.transport.skip() }
            }
        this.live = live
        session =
            MediaLibrarySession.Builder(this, live, StationLibrary())
                .setSessionActivity(
                    PendingIntent.getActivity(
                        this,
                        0,
                        Intent(this, MainActivity::class.java),
                        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                    ),
                )
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

        val words =
            LockScreenWords(
                offAir = getString(R.string.now_off_air),
                onTheMic = { host -> if (host == null) getString(R.string.now_on_the_mic_unnamed) else getString(R.string.now_on_the_mic, host) },
            )
        conductor =
            PlaybackConductor(
                live,
                graph,
                words,
                publishSleep = { session?.setSessionExtras(SleepCommands.extras(it)) },
                // A timer that fires after the task was swiped away would otherwise leave an idle
                // service and its notification behind: `onTaskRemoved` only stops one that is quiet.
                onSlept = { if (taskGone) stopSelf() },
            ).also { it.start() }

        // The next control follows the role rather than the launch, so signing in or out of the
        // operator's account adds and removes the button without restarting anything.
        scope.launch {
            graph.sessions.state
                .map { it is SessionState.SignedIn && it.isOperator }
                .distinctUntilChanged()
                .collect(::allowSkip)
        }
    }

    /** Offer or withdraw the head unit's next control. `LivePlayer` announces the change to whatever draws one. */
    private fun allowSkip(operator: Boolean) {
        live?.setCanSkip(operator)
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

    /** What the station calls itself, as last kept, for a car's list. */
    private suspend fun stationName(): String? {
        val settings = (application as DeadairApp).graph.settings.settings.first()
        val station = settings.station ?: return null
        return settings.stationName ?: station.origin
    }

    /** A future answered on the main scope, for the callbacks that have to read the settings first. */
    private fun <T> answer(block: suspend () -> T): ListenableFuture<T> {
        val future = SettableFuture.create<T>()
        scope.launch {
            try {
                future.set(block())
            } catch (error: Exception) {
                future.setException(error)
            }
        }
        return future
    }

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
    private inner class StationLibrary : MediaLibrarySession.Callback {
        /**
         * The sleep timer's two commands, for this app's own screen and nobody else. Anything bound
         * to the session (a head unit, a car, the system's media controls) gets the ordinary set.
         */
        override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
            val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon()
            if (controller.packageName == packageName) commands.add(SleepCommands.ARM).add(SleepCommands.CLEAR)
            return MediaSession.ConnectionResult.AcceptedResultBuilder(session).setAvailableSessionCommands(commands.build()).build()
        }

        override fun onCustomCommand(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand,
            args: Bundle,
        ): ListenableFuture<SessionResult> {
            val sleep = conductor?.sleep ?: return Futures.immediateFuture(SessionResult(SessionError.ERROR_SESSION_DISCONNECTED))
            when (customCommand.customAction) {
                SleepCommands.ARM.customAction -> {
                    val request = SleepCommands.requestOf(args) ?: return Futures.immediateFuture(SessionResult(SessionError.ERROR_BAD_VALUE))
                    sleep.arm(request)
                }
                SleepCommands.CLEAR.customAction -> sleep.clear()
                else -> return Futures.immediateFuture(SessionResult(SessionError.ERROR_NOT_SUPPORTED))
            }
            return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
        }

        /** One folder, of radio stations. An install with no station kept has nothing to offer. */
        override fun onGetLibraryRoot(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<MediaItem>> =
            answer {
                val name = stationName() ?: return@answer LibraryResult.ofError(SessionError.ERROR_NOT_SUPPORTED)
                LibraryResult.ofItem(MediaItems.root(name), params)
            }

        /** Exactly one child, the station: see `MediaItems.stationEntry` for why never more. */
        override fun onGetChildren(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            parentId: String,
            page: Int,
            pageSize: Int,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> =
            answer {
                val name = stationName()
                if (parentId != MediaItems.ROOT_ID || name == null) return@answer LibraryResult.ofError(SessionError.ERROR_BAD_VALUE)
                LibraryResult.ofItemList(ImmutableList.of(MediaItems.stationEntry(name)), params)
            }

        override fun onGetItem(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            mediaId: String,
        ): ListenableFuture<LibraryResult<MediaItem>> =
            answer {
                val name = stationName()
                if (mediaId != MediaItems.STATION_ID || name == null) return@answer LibraryResult.ofError(SessionError.ERROR_BAD_VALUE)
                LibraryResult.ofItem(MediaItems.stationEntry(name), null)
            }

        /**
         * A car tapping the station hands back only its `mediaId`: the URI does not cross the binder.
         * So the item is resolved here, to the mount the settings and the station agree on, through
         * the same `resumptionItem` a media button uses. Media3's own `onSetMediaItems` comes through
         * here as well, and so does a voice search, which arrives with no id: the library holds one
         * station, so "play something" and "play deadair" both mean it.
         */
        override fun onAddMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: List<MediaItem>,
        ): ListenableFuture<List<MediaItem>> =
            answer {
                if (mediaItems.any { it.mediaId.isNotEmpty() && it.mediaId != MediaItems.STATION_ID }) {
                    throw UnsupportedOperationException("This library holds one station")
                }
                val item = conductor?.resumptionItem() ?: throw UnsupportedOperationException("This install has no station")
                listOf(item)
            }

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
        } else {
            taskGone = true
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
        live = null
        super.onDestroy()
    }

    private companion object {
        const val CONNECT_TIMEOUT_MS = 8_000
        const val READ_TIMEOUT_MS = 15_000

        /** A lock screen shows a cover at a few hundred pixels a side; 1024 is generous and keeps a decoded cover to a few megabytes. */
        const val ARTWORK_MAX_SIDE = 1024
    }
}
