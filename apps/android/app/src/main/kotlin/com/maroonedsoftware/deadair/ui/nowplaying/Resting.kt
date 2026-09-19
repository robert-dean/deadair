package com.maroonedsoftware.deadair.ui.nowplaying

import android.view.accessibility.AccessibilityManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.delay

/** How long Now playing waits, untouched, before it gives the screen to the cover. */
const val REST_AFTER_MS = 6_000L

/** Whether Now playing is resting: the words and controls away, the cover on the whole screen. */
class RestState internal constructor() {
    var resting by mutableStateOf(false)
        internal set

    /** Bumped by every touch; the timer starts again from each one. */
    internal var touches by mutableIntStateOf(0)

    internal fun touch() {
        resting = false
        touches++
    }
}

/**
 * The idle timer behind a resting Now playing.
 *
 * Never while TalkBack is exploring by touch: a control that has faded away is still where it was,
 * but there is nothing on screen for a finger to find, and waking the screen would take a gesture
 * TalkBack keeps for itself. Watched rather than read once, because it is switched on and off
 * while the app is open.
 */
@Composable
fun rememberRest(allowed: Boolean): RestState {
    val state = remember { RestState() }
    val exploring = rememberTouchExploration()
    val may = allowed && !exploring
    LaunchedEffect(may, state.touches) {
        state.resting = false
        if (may) {
            delay(REST_AFTER_MS)
            state.resting = true
        }
    }
    return state
}

@Composable
private fun rememberTouchExploration(): Boolean {
    val manager = LocalContext.current.getSystemService(AccessibilityManager::class.java) ?: return false
    var exploring by remember { mutableStateOf(manager.isTouchExplorationEnabled) }
    DisposableEffect(manager) {
        val listener = AccessibilityManager.TouchExplorationStateChangeListener { exploring = it }
        manager.addTouchExplorationStateChangeListener(listener)
        onDispose { manager.removeTouchExplorationStateChangeListener(listener) }
    }
    return exploring
}

/**
 * Every touch on the screen resets the timer, and the touch that wakes a resting screen does only
 * that: it is consumed before anything under it sees it, so a thumb landing where Stop was cannot
 * stop the station on its way to bringing Stop back.
 */
fun Modifier.wakesRest(rest: RestState): Modifier =
    pointerInput(rest) {
        awaitPointerEventScope {
            while (true) {
                val event = awaitPointerEvent(PointerEventPass.Initial)
                if (event.type != PointerEventType.Press) continue
                val waking = rest.resting
                rest.touch()
                if (waking) event.changes.forEach { it.consume() }
            }
        }
    }
