package com.maroonedsoftware.deadair.director

import com.maroonedsoftware.deadair.sdk.models.StationOrder

/** The running order, as the poll last left it. */
sealed interface OrderState {
    data object SignedOut : OrderState

    data object Loading : OrderState

    data object Unreachable : OrderState

    data class Loaded(val order: StationOrder, val stale: Boolean, val lastGoodAtMs: Long? = null) : OrderState
}
