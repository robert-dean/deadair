package com.maroonedsoftware.deadair.ui.order

import com.maroonedsoftware.deadair.sdk.models.StationItemState
import com.maroonedsoftware.deadair.sdk.models.StationMode
import com.maroonedsoftware.deadair.sdk.models.StationOnEnd
import com.maroonedsoftware.deadair.sdk.models.StationOrder
import com.maroonedsoftware.deadair.sdk.models.StationOrderItem
import com.maroonedsoftware.deadair.sdk.models.StationOrderItemKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The overflow keeps the gates the icons had. */
class OrderMenuTest {
    private fun item(id: String, state: StationItemState = StationItemState.PLANNED) =
        StationOrderItem(id = id, kind = StationOrderItemKind.TRACK, state = state, title = id, artists = emptyList())

    private fun order(name: String = "Afternoon Drift", items: List<StationOrderItem> = listOf(item("a"), item("b"))) =
        StationOrder(name = name, mode = StationMode.ROTATION, onEnd = StationOnEnd.EXTEND, source = "director", items = items)

    private fun List<OrderMenuItem>.verb(verb: OrderVerb) = single { it.verb == verb }

    @Test
    fun `a broadcast offers every verb, the desk first`() {
        assertEquals(
            listOf(OrderVerb.DESK, OrderVerb.AIR_SOMETHING, OrderVerb.ADD_RECORD, OrderVerb.REFILL, OrderVerb.SHUFFLE),
            orderMenu(order(), busy = false).map { it.verb },
        )
        assertTrue(orderMenu(order(), busy = false).all { it.enabled })
    }

    @Test
    fun `off air there is no broadcast for a record to join`() {
        val verbs = orderMenu(order(name = "", items = emptyList()), busy = false).map { it.verb }

        assertFalse(OrderVerb.ADD_RECORD in verbs)
        assertTrue(OrderVerb.AIR_SOMETHING in verbs)
    }

    @Test
    fun `a broadcast that has run out still takes a record`() {
        assertTrue(OrderVerb.ADD_RECORD in orderMenu(order(items = emptyList()), busy = false).map { it.verb })
    }

    @Test
    fun `shuffle needs two rows the player has not been handed`() {
        val one = order(items = listOf(item("a", StationItemState.AIRING), item("b")))

        assertFalse(orderMenu(one, busy = false).verb(OrderVerb.SHUFFLE).enabled)
    }

    @Test
    fun `an action in flight holds refill and shuffle, and nothing else`() {
        val menu = orderMenu(order(), busy = true)

        assertFalse(menu.verb(OrderVerb.REFILL).enabled)
        assertFalse(menu.verb(OrderVerb.SHUFFLE).enabled)
        assertTrue(menu.verb(OrderVerb.DESK).enabled)
        assertTrue(menu.verb(OrderVerb.AIR_SOMETHING).enabled)
    }

    @Test
    fun `before the order answers there is only the desk`() {
        assertEquals(listOf(OrderMenuItem(OrderVerb.DESK)), orderMenu(null, busy = false))
    }
}
