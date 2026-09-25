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
    fun `a broadcast offers every verb`() {
        assertEquals(
            listOf(OrderVerb.AIR_SOMETHING, OrderVerb.ADD_RECORD),
            orderMenu(order()).map { it.verb },
        )
        assertTrue(orderMenu(order()).all { it.enabled })
    }

    @Test
    fun `off air there is no broadcast for a record to join`() {
        val verbs = orderMenu(order(name = "", items = emptyList())).map { it.verb }

        assertFalse(OrderVerb.ADD_RECORD in verbs)
        assertTrue(OrderVerb.AIR_SOMETHING in verbs)
    }

    @Test
    fun `a broadcast that has run out still takes a record`() {
        assertTrue(OrderVerb.ADD_RECORD in orderMenu(order(items = emptyList())).map { it.verb })
    }

    @Test
    fun `before the order answers there is nothing to offer`() {
        assertTrue(orderMenu(null).isEmpty())
    }
}
