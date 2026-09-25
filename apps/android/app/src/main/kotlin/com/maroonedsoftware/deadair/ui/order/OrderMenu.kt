package com.maroonedsoftware.deadair.ui.order

import com.maroonedsoftware.deadair.sdk.models.StationOrder

/** What the operator can do to the station from Up next, beyond a single row. */
enum class OrderVerb {
    AIR_SOMETHING,
    ADD_RECORD,
    REFILL,
    SHUFFLE,
}

data class OrderMenuItem(val verb: OrderVerb, val enabled: Boolean = true)

/**
 * The Up next overflow, in order.
 *
 * Five unlabelled icons sat in the bar, and two of them pushed things on air. They are behind one
 * overflow now, where each can say what it does; What it said stays in the bar because it is the
 * one read, offered to any signed-in listener. The gates are the ones the icons had: a record needs
 * a broadcast to join, a refill or a shuffle waits for the action before it, and a shuffle needs two
 * rows the player has not been handed. Nothing is offered before the order has answered. The desk
 * is not here: it is about the station rather than about what it is playing, and lives in Settings.
 */
fun orderMenu(order: StationOrder?, busy: Boolean): List<OrderMenuItem> {
    if (order == null) return emptyList()
    val nothingOn = order.name.isBlank() && order.items.isEmpty()
    return buildList {
        add(OrderMenuItem(OrderVerb.AIR_SOMETHING))
        // Off air, Air something is the way on; there is no broadcast for one record to join.
        if (!nothingOn) add(OrderMenuItem(OrderVerb.ADD_RECORD))
        add(OrderMenuItem(OrderVerb.REFILL, enabled = !busy))
        add(OrderMenuItem(OrderVerb.SHUFFLE, enabled = !busy && RunningOrderUiState(order.items).plannedCount >= 2))
    }
}
