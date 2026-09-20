package com.maroonedsoftware.deadair.widget

import com.maroonedsoftware.deadair.ui.nowplaying.STOP_ARMED_MS

/** What a press of the widget's Skip means this time. */
enum class SkipPress {
    /** It has armed and changed nothing. The next press within the window cuts the record. */
    ARMED,

    /** Cut it. */
    FIRE,
}

/**
 * Skip, held one press away from firing.
 *
 * The screen's Stop arms for this reason and a steering wheel cannot, which is why the car's next
 * button was accepted as it is. A home screen is the steering wheel's problem with a target the
 * size of a thumb: it collects stray presses in a pocket, and the thing on the other side of this
 * one is everybody's record, cut. So the first press arms and says so by changing the button's
 * name, and it forgets on its own — an armed Skip left sitting there is a Skip that fires on the
 * next stray press, which is the bug this exists to avoid rather than a smaller version of it.
 *
 * The window is the screen's own [STOP_ARMED_MS], because a listener who has met one of these has
 * met the other. Pure and clock-injected, so a test says what it does without waiting five seconds.
 */
class ArmedSkip(private val now: () -> Long, private val window: Long = STOP_ARMED_MS) {
    private var armedAt: Long? = null

    /** Whether it is currently armed, which is what the button's name is drawn from. */
    fun armed(): Boolean = armedAt?.let { now() - it < window } == true

    fun press(): SkipPress {
        if (armed()) {
            armedAt = null
            return SkipPress.FIRE
        }
        armedAt = now()
        return SkipPress.ARMED
    }

    fun disarm() {
        armedAt = null
    }
}
