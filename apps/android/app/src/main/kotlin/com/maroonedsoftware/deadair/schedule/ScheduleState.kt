package com.maroonedsoftware.deadair.schedule

import com.maroonedsoftware.deadair.sdk.models.Persona
import com.maroonedsoftware.deadair.sdk.models.ScheduleNow
import com.maroonedsoftware.deadair.sdk.models.ScheduleSlot

/** One reading of the schedule: the clock and the blocks, plus what is needed to name them. */
data class ScheduleReading(
    val now: ScheduleNow,
    val slots: List<ScheduleSlot>,
    val personas: List<Persona>,
)

/**
 * What the schedule screen has to show.
 *
 * `SignedOut` is a state rather than an empty reading, and that distinction is the screen: "you are
 * not signed in" and "this station has nothing scheduled" are different sentences, and a screen that
 * could not tell them apart would tell a listener to sign in to a station they are already signed
 * in to.
 */
sealed interface ScheduleState {
    data object SignedOut : ScheduleState

    data object Loading : ScheduleState

    data class Answered(val reading: ScheduleReading) : ScheduleState

    /** The station stopped answering. The last good reading is kept, with when it was read, and the screen says so rather than blanking. */
    data class Unreachable(val lastGood: ScheduleReading?, val lastGoodAtMs: Long? = null) : ScheduleState
}
