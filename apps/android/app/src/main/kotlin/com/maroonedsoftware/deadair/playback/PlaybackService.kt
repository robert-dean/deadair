package com.maroonedsoftware.deadair.playback

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import androidx.core.content.ContextCompat
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.session.CacheBitmapLoader
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaConstants
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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.update
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

    /**
     * Whether the phone's display is on, for `PlaybackConductor`'s poll cadence and nothing else.
     *
     * Registered rather than asked each time, because what it answers is "could somebody be
     * reading the lock screen right now", and that question has to be answered continuously. The
     * two actions are protected system broadcasts and cannot be sent by another app; they also
     * cannot be declared in the manifest, which is why this is here and lives as long as the
     * service does. Off by default: a service created with nothing playing has nothing to show.
     */
    private val displayOn = MutableStateFlow(false)
    private val displayWatcher =
        object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                displayOn.value = intent?.action == Intent.ACTION_SCREEN_ON
            }
        }

    /**
     * The phone's default network, by handle, or `null` for none: for `ReconnectPolicy` to hold a
     * drop until there is one rather than spend its budget retrying against nothing, and to move a
     * mount's connection when the default network changes under it.
     *
     * Any default network, not a VALIDATED one: a station on the home network is reached over a
     * wifi that may have no internet behind it, and Android never validates that wifi. The network
     * is tracked by handle because a handover can deliver the new network's `onAvailable` before
     * the old one's `onLost`, and that late `onLost` must not report a phone that is online as off.
     * Callbacks arrive on the system's connectivity thread; the flow is what carries them to main.
     */
    private val defaultNetwork = MutableStateFlow<Long?>(null)

    /** The default network with its kind, for [StallFallback], which moves only off a wifi. */
    private val defaultKind = MutableStateFlow<DefaultNetwork?>(null)

    /** The validated cellular network standing by, by handle, for [StallFallback]. */
    private val standby = MutableStateFlow<Long?>(null)

    /**
     * The cellular network the process is bound to while a stalled stream has been moved off a
     * wifi, or `null` while it follows the default. What the reconnect policy hears is this when
     * set and the default otherwise, so pinning is a network move to it and releasing is a move
     * back (or no move at all, when the default has become that same cellular network).
     */
    private val pinned = MutableStateFlow<Long?>(null)

    private val main = Handler(Looper.getMainLooper())
    private var fallback: StallFallback? = null

    /** The outstanding request for cellular, while [fallback] is engaged. */
    private var cellularRequest: ConnectivityManager.NetworkCallback? = null

    /**
     * The same network changes, with their kind and validation, for the playback journal. Lazy
     * because the graph is not there until the service is attached, and the first callback comes
     * after `onCreate` registers this.
     */
    private val networkNotes by lazy { NetworkNotes(::note) }
    private val networkWatcher =
        object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                defaultNetwork.value = network.networkHandle
            }

            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                val kind = transportOf(capabilities)
                networkNotes.onDefault(network.networkHandle, kind, capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED))
                defaultKind.value = DefaultNetwork(network.networkHandle, kind)
            }

            override fun onLost(network: Network) {
                defaultNetwork.compareAndSet(network.networkHandle, null)
                networkNotes.onLost(network.networkHandle)
                defaultKind.update { if (it?.handle == network.networkHandle) null else it }
            }
        }

    /**
     * Whether a validated cellular network is up beside the default, for the journal. Listen-only,
     * so it never brings mobile data up itself: see [CellularStandby].
     */
    private val cellularStandby by lazy { CellularStandby(::note) }
    private val cellularWatcher =
        object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                cellularStandby.onCapabilities(network.networkHandle, capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED))
                standby.value = cellularStandby.standby
            }

            override fun onLost(network: Network) {
                cellularStandby.onLost(network.networkHandle)
                standby.value = cellularStandby.standby
            }
        }

    /** A line for logcat and the playback journal, from beside the player. Any thread. */
    private fun note(line: String) {
        Log.i(PlaybackLog.TAG, line)
        (application as DeadairApp).graph.playbackJournal.record(line)
    }

    /**
     * Ask for cellular for a stream that has stalled on wifi, and bind the process to it when it
     * comes. A REQUEST rather than the network [standby] names, because that one is a background
     * network and Android carries no app's traffic over it; requested, it is brought to the
     * foreground, which is quick because it is already up. Bound before [pinned] is set, so the
     * restart that follows connects over it.
     */
    private fun requestCellular() {
        val connectivity = getSystemService(ConnectivityManager::class.java)
        if (connectivity == null) {
            fallback?.onUnanswered()
            return
        }
        if (cellularRequest != null) return
        val callback =
            object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    if (cellularRequest !== this) return
                    connectivity.bindProcessToNetwork(network)
                    pinned.value = network.networkHandle
                    fallback?.onPinned(network.networkHandle)
                }

                override fun onLost(network: Network) {
                    if (pinned.value == network.networkHandle) fallback?.onCellularLost()
                }

                override fun onUnavailable() {
                    if (cellularRequest === this) fallback?.onUnanswered()
                }
            }
        cellularRequest = callback
        connectivity.requestNetwork(
            NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_CELLULAR)
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build(),
            callback,
            main,
            CELLULAR_REQUEST_TIMEOUT_MS,
        )
    }

    /** Unbind, drop the request, and let the stream follow the default again. Safe to call twice. */
    private fun releaseCellular() {
        val callback = cellularRequest ?: return
        cellularRequest = null
        getSystemService(ConnectivityManager::class.java)?.let { connectivity ->
            connectivity.bindProcessToNetwork(null)
            // Already unregistered by the system when the request timed out.
            runCatching { connectivity.unregisterNetworkCallback(callback) }
        }
        pinned.value = null
    }

    /** One word for what kind of network this is. A VPN first, because it rides on top of one of the others. */
    private fun transportOf(capabilities: NetworkCapabilities): String =
        when {
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_BLUETOOTH) -> "bluetooth"
            else -> "other"
        }

    /**
     * The kept station, for the library root. Collected from `onCreate` so the root can be answered
     * without reading anything: see [KeptStation] for the ANR that made it so.
     */
    private val kept = MutableStateFlow<KeptStation>(KeptStation.Unread)

    override fun onCreate() {
        super.onCreate()
        val graph = (application as DeadairApp).graph
        setMediaNotificationProvider(LiveNotificationProvider(this))

        displayOn.value = getSystemService(PowerManager::class.java)?.isInteractive == true
        ContextCompat.registerReceiver(
            this,
            displayWatcher,
            IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_ON)
                addAction(Intent.ACTION_SCREEN_OFF)
            },
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )

        getSystemService(ConnectivityManager::class.java)?.let { connectivity ->
            defaultNetwork.value = connectivity.activeNetwork?.networkHandle
            connectivity.registerDefaultNetworkCallback(networkWatcher)
            val cellular =
                NetworkRequest.Builder()
                    .addTransportType(NetworkCapabilities.TRANSPORT_CELLULAR)
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            // A request asks for FOREGROUND unless told otherwise, and the cellular network Android
            // keeps up beside a wifi is a BACKGROUND network, without it: on the Pixel on 2026-10-20
            // and on the emulator alike, so with the default this heard nothing at all. Removing it
            // is not enough on its own: the system puts FOREGROUND back on every listen from an app
            // without CHANGE_NETWORK_STATE, which is why the manifest asks for that. The constant is
            // API 28; on 26 and 27 this hears foreground cellular only, which is a default network
            // and already written as one.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) cellular.removeCapability(NetworkCapabilities.NET_CAPABILITY_FOREGROUND)
            connectivity.registerNetworkCallback(cellular.build(), cellularWatcher)
        }

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

        val fallback =
            StallFallback(
                schedule = { ms, run ->
                    val task = Runnable(run)
                    main.postDelayed(task, ms)
                    ({ main.removeCallbacks(task) })
                },
                request = ::requestCellular,
                release = ::releaseCellular,
                note = ::note,
            )
        this.fallback = fallback
        scope.launch { defaultKind.collect { fallback.onDefault(it?.handle, it?.kind) } }
        scope.launch { standby.collect(fallback::onStandby) }
        player.addListener(StallWatch(player, fallback))
        session =
            MediaLibrarySession.Builder(this, live, StationLibrary())
                .setSessionActivity(openApp)
                // Fatal, so the car shows "no station" as the whole screen with its button rather
                // than as a passing notice over a player with nothing in it: see `onGetChildren`.
                // The only error this library replicates is that one, and it clears itself the
                // first time the children are answered with the station.
                .setLibraryErrorReplicationMode(MediaLibrarySession.LIBRARY_ERROR_REPLICATION_MODE_FATAL)
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
                displayOn = displayOn,
                network = combine(defaultNetwork, pinned) { default, pin -> pin ?: default },
                publishSleep = { session?.setSessionExtras(SleepCommands.extras(it)) },
                // A timer that fires after the task was swiped away would otherwise leave an idle
                // service and its notification behind: `onTaskRemoved` only stops one that is quiet.
                onSlept = { if (taskGone) stopSelf() },
                onHeard = live::setHeard,
            ).also { it.start() }

        scope.launch { graph.settings.settings.collect { kept.value = KeptStation.of(it) } }

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

    /** The app's own screen, for the session's activity and for a car's "open the app" button. */
    private val openApp: PendingIntent by lazy {
        PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    /**
     * What a car is told when no station has been chosen, with a button that opens the app on the
     * phone. `AUTHENTICATION_EXPIRED` is not a claim about an account: it is one of the two codes
     * Media3 replicates into the platform playback state, which is where Android Auto reads an
     * error and its resolution from, and it is the code Auto's own guidance gives an app that needs
     * something done on the phone first. `SETUP_REQUIRED` says it better and reaches no car.
     */
    private fun noStation(): SessionError =
        SessionError(
            SessionError.ERROR_SESSION_AUTHENTICATION_EXPIRED,
            getString(R.string.auto_no_station),
            Bundle().apply {
                putString(MediaConstants.EXTRAS_KEY_ERROR_RESOLUTION_ACTION_LABEL_COMPAT, getString(R.string.auto_open_app))
                putParcelable(MediaConstants.EXTRAS_KEY_ERROR_RESOLUTION_ACTION_INTENT_COMPAT, openApp)
            },
        )

    /** What the station calls itself, as last kept, for a car's list. */
    private suspend fun stationName(): String? {
        val settings = (application as DeadairApp).graph.settings.settings.first()
        val station = settings.station ?: return null
        return settings.stationName ?: station.origin
    }

    /**
     * A future answered on the main scope, for the callbacks that have to read the settings first.
     *
     * Never for the library root: see `onGetLibraryRoot`. The others are safe because Media3 answers
     * a legacy browser's children, item and search requests asynchronously.
     */
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

        /**
         * One folder, of radio stations. Offered even with no station kept: see [libraryRootTitle]
         * for why a refusal here reads, in a car, as an app that cannot load.
         *
         * Answered with a future that is already complete, and it must stay that way. A legacy
         * browser's request for the root runs this on the main thread and blocks that thread until
         * the future completes, so anything that suspends here (the settings read the other
         * callbacks make, which resumes on the main thread) waits on itself for ever: an ANR.
         */
        override fun onGetLibraryRoot(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<MediaItem>> {
            val title = libraryRootTitle(kept.value, getString(R.string.app_name))
            return Futures.immediateFuture(LibraryResult.ofItem(MediaItems.root(title), params))
        }

        /**
         * Exactly one child, the station: see `MediaItems.stationEntry` for why never more.
         *
         * With no station kept, the folder is not empty but an error a car can act on, because an
         * empty folder in a car is a dead end with no way out of it (Play's Auto review calls that
         * content that cannot load). See [noStation].
         */
        override fun onGetChildren(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            parentId: String,
            page: Int,
            pageSize: Int,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> =
            answer {
                if (parentId != MediaItems.ROOT_ID) return@answer LibraryResult.ofError(SessionError.ERROR_BAD_VALUE)
                val name = stationName() ?: return@answer LibraryResult.ofError(noStation())
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
        unregisterReceiver(displayWatcher)
        releaseCellular()
        fallback = null
        getSystemService(ConnectivityManager::class.java)?.let { connectivity ->
            connectivity.unregisterNetworkCallback(networkWatcher)
            connectivity.unregisterNetworkCallback(cellularWatcher)
        }
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

        /** How long a request for cellular may take. The network is already up in the background, so this is generous. */
        const val CELLULAR_REQUEST_TIMEOUT_MS = 5_000
    }

    /** The default network and what kind it is. */
    private data class DefaultNetwork(val handle: Long, val kind: String)

    /**
     * Tells [StallFallback] when playback that was running starts buffering, when it runs again,
     * when it fails in one of the two ways a dying wifi fails without buffering, and when it stops: the same reading of the player's states `PlaybackLog` writes as `stall`
     * and `resumed`.
     */
    private class StallWatch(private val player: Player, private val fallback: StallFallback) : Player.Listener {
        private var ready = false

        override fun onPlaybackStateChanged(playbackState: Int) {
            when (playbackState) {
                Player.STATE_BUFFERING -> if (ready && player.playWhenReady) fallback.onStall()
                Player.STATE_READY -> {
                    ready = true
                    fallback.onResumed()
                }
                else -> {
                    ready = false
                    fallback.onResumed()
                }
            }
        }

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            if (!playWhenReady) fallback.onStopped()
        }

        override fun onPlayerError(error: PlaybackException) {
            if (!player.playWhenReady) return
            when (error.errorCode) {
                PlaybackException.ERROR_CODE_TIMEOUT -> fallback.onFailure(StallFallback.Failure.Stuck)
                PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW -> fallback.onFailure(StallFallback.Failure.BehindLive)
            }
        }
    }
}
