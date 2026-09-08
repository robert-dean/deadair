package com.maroonedsoftware.deadair.ui.nowplaying

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.coroutines.delay

/** How long an armed Stop stays armed before it forgets, in ms. The console's own figure. */
const val STOP_ARMED_MS = 5_000L

/** Stop, held one press away from firing. */
class ArmedStop internal constructor(private val fire: () -> Unit) {
    var armed by mutableStateOf(false)
        private set

    /** Arms on the first press, fires on the second. */
    fun press() {
        if (armed) {
            armed = false
            fire()
        } else {
            armed = true
        }
    }

    internal fun disarm() {
        armed = false
    }
}

/**
 * Stop is the only control on this screen that takes the station off air, and it sits a thumb's
 * width from Skip, which ends one record. A confirm dialog is the ordinary answer and the wrong
 * one on a phone used from bed: a modal over a button is a second target to find rather than a
 * moment to think. So the button arms itself and says so by changing its name, and disarms on its
 * own — a Stop left armed on a phone in a pocket is a Stop that fires on the next stray press.
 */
@Composable
fun rememberArmedStop(fire: () -> Unit): ArmedStop {
    val stop = remember { ArmedStop(fire) }
    LaunchedEffect(stop.armed) {
        if (stop.armed) {
            delay(STOP_ARMED_MS)
            stop.disarm()
        }
    }
    return stop
}
