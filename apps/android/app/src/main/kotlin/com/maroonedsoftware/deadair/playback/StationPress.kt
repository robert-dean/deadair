package com.maroonedsoftware.deadair.playback

import android.content.Context
import com.maroonedsoftware.deadair.settings.SettingsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Where a press is carried out, which is NEVER the scope of whatever was pressed.
 *
 * A Quick Settings tile is bound only while the shade is open, and a press is often the last thing
 * before it closes: `onStopListening` and then `onDestroy` can follow within the second the playback
 * service takes to bind. A widget is worse — the launcher's click reaches a `BroadcastReceiver`
 * whose own lifetime ends the moment its callback returns. A press made in either scope would be
 * cancelled halfway, and a press that does nothing is the one failure these surfaces must not have.
 * This scope lives as long as the process does.
 */
internal val presses = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

/** How long a press waits for the playback service to bind before giving up on it. */
private const val BIND_WAIT_MS = 5_000L

/**
 * How long it then waits for the player to take the press up.
 *
 * Not the warm-up: this is only the gap between sending `play()` and the player leaving IDLE, which
 * is a moment. The timeout is for the press that is never taken up at all.
 */
private const val START_WAIT_MS = 5_000L

/**
 * Turn the station over: what every surface outside the app means by its play/stop button.
 *
 * Decided afresh from the kept station and the bound player rather than from whatever the surface
 * last drew, because a drawing can be a minute old (a widget's is, by design) and because `play()`
 * before the controller has bound is silently nothing. The connection is taken for the press and
 * released after it, so nothing here holds `PlaybackService` alive on behalf of a button.
 */
fun pressStation(context: Context, settings: SettingsStore) {
    presses.launch {
        val kept = settings.settings.first()
        val connection = PlayerConnection(context)
        try {
            connection.connect()
            val player = withTimeoutOrNull(BIND_WAIT_MS) { connection.state.first { it.connected } } ?: return@launch
            when (tileReading(kept.station != null, player)) {
                TileReading.NO_STATION -> Unit
                TileReading.PLAYING, TileReading.WARMING_UP -> connection.stop()
                TileReading.STOPPED -> {
                    connection.play()
                    // Hold the controller until the player has actually taken it up, which is what
                    // `buffering` says. `play()` only sends the command: a `MediaSessionService`
                    // whose last controller unbinds while the player is still IDLE stops itself,
                    // and the command then lands on a service that is already dying.
                    //
                    // The Quick Settings tile never showed this because it keeps a connection of
                    // its own for as long as the shade is open, so the press was never the only
                    // one bound. From the home-screen widget it is, and the press did nothing at
                    // all: measured, the session went BUFFERING and was destroyed 30ms later.
                    withTimeoutOrNull(START_WAIT_MS) { connection.state.first { it.playing || it.buffering } }
                }
            }
        } finally {
            connection.release()
        }
    }
}
