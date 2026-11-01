package com.maroonedsoftware.deadair.auth

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** How long the app may be out of sight before the operator's controls want unlocking again. */
const val OPERATOR_LOCK_GRACE_MS = 5 * 60 * 1000L

/**
 * Whether somebody has proved they are the phone's owner since the app was last away for a while.
 *
 * This is a gate on what the app DRAWS, and nothing else. The tokens stay readable, because the
 * player, the widget and a car's next button all reach them with nobody at the screen, and the
 * station knows nothing of it. What it answers is an unlocked phone in somebody else's hand.
 *
 * Starts shut, so a new process asks whatever the last one was told. [now] is a clock the phone's
 * owner cannot set back: `elapsedRealtime`, which keeps counting through sleep.
 */
class OperatorLock(private val now: () -> Long) {
    private val open = MutableStateFlow(false)
    private var leftAt: Long? = null

    /** Whether the controls are open, whatever the setting says. */
    val isOpen: StateFlow<Boolean> = open.asStateFlow()

    /** The phone's owner just proved it. */
    fun unlocked() {
        open.value = true
        leftAt = null
    }

    /** The app went out of sight. A rotation lands here too, and comes back well inside the grace. */
    fun left() {
        if (open.value) leftAt = now()
    }

    /** The app came back. Shuts the lock if it was away for the whole of the grace. */
    fun returned() {
        val away = leftAt ?: return
        leftAt = null
        if (now() - away >= OPERATOR_LOCK_GRACE_MS) open.value = false
    }
}
