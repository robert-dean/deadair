package com.maroonedsoftware.deadair.playout

import com.maroonedsoftware.deadair.auth.Notice
import com.maroonedsoftware.deadair.auth.OperatorActions
import com.maroonedsoftware.deadair.sdk.DeadairSdk
import com.maroonedsoftware.deadair.sdk.models.AirMode
import com.maroonedsoftware.deadair.sdk.models.HoldStationInput
import com.maroonedsoftware.deadair.sdk.models.PlayoutStatus
import com.maroonedsoftware.deadair.sdk.models.SetStationAirInput
import com.maroonedsoftware.deadair.sdk.models.StationAir

/**
 * The transport, from a pocket: skip, stop, start, hold and the air mode.
 *
 * Each one applies the station's answer to the screen at once and then asks again over the next
 * seconds, which is what the console does after every action and for the same reason — the answer
 * to "skip" is the status the instant after the skip, and the encoder catching up is a second or
 * two behind it.
 */
class Transport(private val actions: OperatorActions, private val playout: PlayoutRepository) {
    suspend fun skip() = status { it.playout.skipTheCurrentItem() }

    suspend fun stop() = status { it.playout.stopPlayout() }

    /** 409 is not a fault: the station was never put on air, so there is nothing to resume. */
    suspend fun start() = status(expected = mapOf(CONFLICT to Notice.NothingToResume)) { it.playout.startPlayout() }

    /** `null` minutes holds until released by hand. */
    suspend fun hold(minutes: Long?) = air { it.director.holdTheStationAgainstTheSchedule(HoldStationInput(minutes = minutes)) }

    suspend fun release() = air { it.director.releaseTheStationToTheSchedule() }

    suspend fun setAirMode(mode: AirMode) = air { it.director.setTheAirMode(SetStationAirInput(airMode = mode)) }

    private suspend fun status(expected: Map<Int, Notice> = emptyMap(), action: suspend (DeadairSdk) -> PlayoutStatus) {
        actions.run(expected, action)?.let(playout::apply)
        playout.refetchSoon()
    }

    private suspend fun air(action: suspend (DeadairSdk) -> StationAir) {
        actions.run(action = action)?.let(playout::applyAir)
        playout.refetchSoon()
    }

    private companion object {
        const val CONFLICT = 409
    }
}
