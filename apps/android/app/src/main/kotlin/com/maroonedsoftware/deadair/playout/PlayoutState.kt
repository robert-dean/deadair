package com.maroonedsoftware.deadair.playout

import com.maroonedsoftware.deadair.sdk.models.PlayoutStatus
import com.maroonedsoftware.deadair.sdk.models.StationAir

/**
 * The transport reading: what the station's playout is doing, and who is driving it.
 *
 * Two readings rather than one because the API answers them separately and at different rates,
 * and the console polls them at different rates for that reason: status every two seconds,
 * because "on air" and "listeners" are what an operator watches change; air every five, because
 * who is driving the station changes when somebody makes it.
 */
sealed interface PlayoutState {
    data object SignedOut : PlayoutState

    data object Loading : PlayoutState

    /** The status has never arrived, so there is nothing to show as stale. */
    data object Unreachable : PlayoutState

    data class Loaded(
        val status: PlayoutStatus,
        /** Absent until the slower poll has answered once, which is a moment after the first. */
        val air: StationAir?,
        /** The status poll is failing. What is here was true a moment ago. */
        val stale: Boolean,
        val lastGoodAtMs: Long? = null,
    ) : PlayoutState
}
