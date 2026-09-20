package com.maroonedsoftware.deadair.widget

import com.maroonedsoftware.deadair.nowplaying.NowPlayingState
import com.maroonedsoftware.deadair.sdk.models.NowPlaying
import com.maroonedsoftware.deadair.settings.ListenerSettings
import com.maroonedsoftware.deadair.ui.nowplaying.STOP_ARMED_MS
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * Whether a reading straight off the poll is the one to draw.
 *
 * Only while this phone is not playing. `NowPlayingGate` holds a moved record back until the audio
 * carrying it has actually reached the listener's ears, which is why the lock screen changes when
 * the record does rather than up to a buffer's length early; a widget drawing the raw poll beside
 * it would contradict the notification on the same screen, for the same reading.
 */
fun takesHeard(playback: WidgetPlayback): Boolean = playback == WidgetPlayback.STOPPED

/**
 * What keeps the widget's snapshot current, and the only thing that writes it.
 *
 * Process-lifetime, and deliberately NOT a collector of `NowPlayingRepository.state`: that flow is
 * `WhileSubscribed`, so subscribing here would hold the station's poll open for as long as the
 * process lived. It takes `heard` instead, which carries whatever the screen or the playback
 * service is already asking for and is silent otherwise. Under the default settings a phone with
 * nothing playing and the app closed therefore writes nothing, draws nothing and asks the station
 * nothing — the live wallpaper's rule, for the same reason.
 *
 * Every input arrives through one channel and is applied by one loop, so a reading, a press and a
 * station change cannot interleave into a half-updated snapshot. The loop hydrates from disk before
 * it reads the first of them.
 */
class WidgetFeed(
    private val store: WidgetSnapshotStore,
    private val settings: Flow<ListenerSettings>,
    private val heard: Flow<NowPlayingState>,
    /** Whether the signed-in account is the station's. Read off disk, so collecting it asks the station nothing. */
    private val operator: Flow<Boolean>,
    /** The operator's Skip, which the API decides and this only offers. */
    private val skip: suspend () -> Unit,
    private val now: () -> Long,
    /** Tell the launcher to ask for the widget again. A lambda so nothing here has to import Glance. */
    private val redraw: suspend () -> Unit,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow<WidgetState?>(null)

    /** Null until the snapshot has been read off disk, which is what [current] waits for. */
    val state: StateFlow<WidgetState?> = _state.asStateFlow()

    private val updates = Channel<Update>(Channel.UNLIMITED)

    /**
     * Redraw requests, conflated and carried out by a coroutine of their own.
     *
     * Not awaited by the loop below, and that is not an optimisation. A Glance update suspends until
     * the launcher's composition has run, which happens inside a WorkManager job — so awaiting it
     * would put the station's readings behind the system's job scheduler, and a phone busy enough to
     * delay that job would be a phone whose widget then fell minutes behind what it had already
     * been told. Conflated because only the newest state is worth drawing: three readings that
     * arrive while one drawing is in flight are one drawing, not three.
     */
    private val redraws = Channel<Unit>(Channel.CONFLATED)

    private sealed interface Update {
        data class Playing(val playback: WidgetPlayback) : Update

        /** A reading the gate has released: the audio has caught up to it. */
        data class Aired(val now: NowPlaying) : Update

        data class Heard(val state: NowPlayingState) : Update

        data class Station(val origin: String?, val name: String?) : Update

        data class Operator(val operator: Boolean) : Update

        /** A press of Skip, which arms before it fires. */
        data object SkipPressed : Update

        /** The armed window ran out with no second press. */
        data object SkipForgotten : Update
    }

    /**
     * What the widget draws from, once it is known.
     *
     * A suspend read rather than a value, because the widget can be asked for before this app's
     * process has finished starting — the launcher's request is often WHY it started.
     */
    suspend fun current(): WidgetState = state.filterNotNull().first()

    fun start() {
        scope.launch {
            // Hydration asks for no drawing, and that is not a saving: what is on disk is exactly
            // what the launcher is already showing, because the two were written together. Asking
            // here would start a Glance composition — and with it WorkManager — from inside
            // `Application.onCreate`, every time anything starts this process. Measured: the
            // process was killed with `failed to complete startup` before it ever drew anything.
            _state.value = WidgetState(store.snapshot.first())
            for (update in updates) apply(update)
        }
        scope.launch {
            // A drawing that fails is not worth taking the feed down for: the next reading asks
            // for another one, and what is on the home screen until then is a minute old rather
            // than gone.
            for (ignored in redraws) runCatching { redraw() }
        }
        scope.launch { heard.collect { updates.trySend(Update.Heard(it)) } }
        scope.launch { operator.distinctUntilChanged().collect { updates.trySend(Update.Operator(it)) } }
        scope.launch {
            settings
                .map { it.station?.origin to it.stationName }
                .distinctUntilChanged()
                .collect { (origin, name) -> updates.trySend(Update.Station(origin, name)) }
        }
    }

    /** What this phone is doing about the station. Reported by the playback service, which is the only thing that knows. */
    fun onPlayback(playback: WidgetPlayback) {
        updates.trySend(Update.Playing(playback))
    }

    /** A reading whose audio is now playing, straight from `NowPlayingGate`. */
    fun onAired(now: NowPlaying?) {
        if (now != null) updates.trySend(Update.Aired(now))
    }

    /** The operator pressed Skip. The first press arms it; the second, within the window, cuts the record. */
    fun onSkipPressed() {
        updates.trySend(Update.SkipPressed)
    }

    /** The origin the snapshot describes, so pointing the app at another station is noticed. */
    private var origin: String? = null
    private var stationName: String? = null

    /** Lives here rather than in the snapshot on disk: a process that died forgets it, which is the safe way round. */
    private val armed = ArmedSkip(now)
    private var forgetting: Job? = null

    private suspend fun apply(update: Update) {
        val was = _state.value ?: return
        when (update) {
            is Update.Playing -> draw(was.copy(playback = update.playback))
            is Update.Operator -> {
                // Signing out disarms: a Skip left armed by an account the station no longer knows
                // is a press that would only be refused, and the button is about to disappear.
                if (!update.operator) forget()
                draw(was.copy(operator = update.operator, skipArmed = armed.armed()))
            }
            Update.SkipPressed ->
                when (armed.press()) {
                    SkipPress.ARMED -> {
                        forgetting?.cancel()
                        forgetting = scope.launch {
                            delay(STOP_ARMED_MS)
                            updates.trySend(Update.SkipForgotten)
                        }
                        draw(was.copy(skipArmed = true))
                    }
                    // The call, not the player: this is the station's running order rather than
                    // this phone's audio, so it works whether or not anybody here is listening.
                    // A 403 re-reads the roles, the operator flow falls, and the button goes.
                    SkipPress.FIRE -> {
                        forgetting?.cancel()
                        forgetting = null
                        draw(was.copy(skipArmed = false))
                        scope.launch { runCatching { skip() } }
                    }
                }
            Update.SkipForgotten -> {
                forget()
                draw(was.copy(skipArmed = false))
            }
            is Update.Aired -> keep(was, snapshotOf(update.now, stationName, now()))
            is Update.Heard ->
                when (val state = update.state) {
                    // Before the first answer nothing is known, and claiming otherwise would
                    // blank a widget that is showing something true.
                    NowPlayingState.Loading -> Unit
                    // The age is the age of the last thing the station SAID, so it does not move
                    // for a poll that failed. Only the mark against it does.
                    is NowPlayingState.Unreachable -> keep(was, was.snapshot.copy(reachable = false))
                    is NowPlayingState.Answered ->
                        if (takesHeard(was.playback)) {
                            keep(was, snapshotOf(state.reading.nowPlaying, stationName, now()))
                        } else {
                            // While playing, WHAT is on is the gate's to say, and it is a few
                            // seconds behind this on purpose. Whether the station is answering at
                            // all is still the poll's, though: without this, one failed request
                            // during a record left "Can't reach the station" on the home screen
                            // over a record that was playing perfectly well, until the next one
                            // moved the gate. Measured on the emulator.
                            keep(was, was.snapshot.copy(reachable = true))
                        }
                }
            is Update.Station -> {
                stationName = update.name
                if (update.origin != origin) {
                    val first = origin == null
                    origin = update.origin
                    // The old station's record is not this one's. Cleared rather than left to be
                    // overwritten, because under the resting default nothing may ever overwrite it.
                    if (!first) {
                        store.clear()
                        draw(WidgetState(WidgetSnapshot(stationName = update.name), was.playback))
                    } else if (was.snapshot.stationName == null && update.name != null) {
                        keep(was, was.snapshot.copy(stationName = update.name))
                    }
                }
            }
        }
    }

    /** Write a snapshot if it is worth writing, and redraw either way. */
    private suspend fun keep(was: WidgetState, next: WidgetSnapshot) {
        if (!worthDrawing(was.snapshot, next)) return
        store.save(next)
        draw(was.copy(snapshot = next))
    }

    private fun draw(next: WidgetState) {
        if (next == _state.value) return
        _state.value = next
        ask()
    }

    private fun forget() {
        forgetting?.cancel()
        forgetting = null
        armed.disarm()
    }

    /** Ask for a drawing. Never waits for one: see [redraws]. */
    private fun ask() {
        redraws.trySend(Unit)
    }
}
