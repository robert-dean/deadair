package com.maroonedsoftware.deadair.ui.order

import com.maroonedsoftware.deadair.sdk.models.StationOrder

/** What the operator can do to the station from Up next, beyond a single row. */
enum class OrderVerb {
    AIR_SOMETHING,
    ADD_RECORD,
}

data class OrderMenuItem(val verb: OrderVerb, val enabled: Boolean = true)

/**
 * What the Manage page offers to put on air, in order.
 *
 * Something to air is always offered, since off air it is the way on. A record needs a broadcast to
 * join. Nothing is offered before the order has answered. Refill and Shuffle were here and are not:
 * the station refills a broadcast by itself, and Shuffle is on Now playing beside the record it
 * reorders around.
 */
fun orderMenu(order: StationOrder?): List<OrderMenuItem> {
    if (order == null) return emptyList()
    val nothingOn = order.name.isBlank() && order.items.isEmpty()
    return buildList {
        add(OrderMenuItem(OrderVerb.AIR_SOMETHING))
        // Off air, Air something is the way on; there is no broadcast for one record to join.
        if (!nothingOn) add(OrderMenuItem(OrderVerb.ADD_RECORD))
    }
}
