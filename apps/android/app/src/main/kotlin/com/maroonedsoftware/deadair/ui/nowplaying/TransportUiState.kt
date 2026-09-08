package com.maroonedsoftware.deadair.ui.nowplaying

import com.maroonedsoftware.deadair.sdk.models.AirMode
import com.maroonedsoftware.deadair.sdk.models.AirSource
import com.maroonedsoftware.deadair.sdk.models.PlayoutStatus
import com.maroonedsoftware.deadair.sdk.models.StationAir
import com.maroonedsoftware.deadair.ui.text.Clock
import com.maroonedsoftware.deadair.ui.text.Message
import java.time.Instant
import java.time.ZoneId

/** Whether, and how, the schedule has been told to leave this broadcast alone. */
sealed interface HoldUi {
    /** A person is driving and the schedule will take it back at the next block. Offer to keep it on. */
    data object Offered : HoldUi

    data object HeldUntilReleased : HoldUi

    data class HeldUntil(val clock: Clock) : HoldUi
}

/**
 * The operator's controls, as data: which are drawn, which are enabled, and what the line under
 * them says. The console's rules, carried over so a phone and a laptop never disagree about
 * whether Skip is worth pressing.
 */
data class TransportUiState(
    val status: PlayoutStatus,
    val air: StationAir?,
    /** An action is in flight, so every control waits for it rather than queueing a second one. */
    val busy: Boolean = false,
    val zone: ZoneId = ZoneId.systemDefault(),
) {
    /** Nothing on air is nothing to cut, and a skip needs a stream to take it. */
    val skipEnabled: Boolean get() = !busy && status.streamUp && status.nowPlaying != null

    /** A stood-down station shows Start where Stop would be. Unknown until the air reading arrives, and Stop until then. */
    val showsStart: Boolean get() = air?.active == false

    val airMode: AirMode? get() = air?.airMode

    /** Who chose what is on, in the words the answer is in. Nothing while the station is off. */
    val driving: Message?
        get() =
            when (air?.airSource) {
                AirSource.SCHEDULE -> Message.SchedulePutThisOn
                AirSource.SUSTAINING -> Message.BetweenBlocks
                AirSource.OPERATOR -> Message.YouPutThisOn
                AirSource.OFF, null -> null
            }

    /**
     * Offered only while a person is driving, because holding the schedule off a broadcast the
     * schedule itself put on is not a thing to want. `holdUntil` absent WHILE held is the hold that
     * never lapses, which is a real state and not a missing value.
     */
    val hold: HoldUi?
        get() {
            val current = air ?: return null
            if (current.airSource != AirSource.OPERATOR) return null
            if (!current.held) return HoldUi.Offered
            val until = current.holdUntil ?: return HoldUi.HeldUntilReleased
            val at = Instant.parse(until).atZone(zone)
            return HoldUi.HeldUntil(Clock(at.hour, at.minute))
        }
}
