package com.maroonedsoftware.deadair.ui.order

import com.maroonedsoftware.deadair.sdk.models.StationItemState
import com.maroonedsoftware.deadair.sdk.models.StationOrderItem
import com.maroonedsoftware.deadair.sdk.models.StationOrderItemKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Where a dragged row may land, and how the list looks when it does. */
class DragReorderTest {
    private fun item(id: String, state: StationItemState) =
        StationOrderItem(id = id, kind = StationOrderItemKind.TRACK, state = state, title = id, artists = emptyList())

    // Two played, one on air, one handed over, three planned.
    private val items =
        listOf(
            item("a", StationItemState.PLAYED),
            item("b", StationItemState.PLAYED),
            item("c", StationItemState.AIRING),
            item("d", StationItemState.HANDED),
            item("e", StationItemState.PLANNED),
            item("f", StationItemState.PLANNED),
            item("g", StationItemState.PLANNED),
        )

    @Test
    fun `a row moved down lands after the rows it passed`() {
        assertEquals(listOf("a", "c", "d", "b"), listOf("a", "b", "c", "d").moved(1, 3))
    }

    @Test
    fun `a row moved up lands before the rows it passed`() {
        assertEquals(listOf("d", "a", "b", "c"), listOf("a", "b", "c", "d").moved(3, 0))
    }

    @Test
    fun `a move to where it is, or off the end, changes nothing`() {
        val list = listOf("a", "b")
        assertEquals(list, list.moved(1, 1))
        assertEquals(list, list.moved(1, 5))
    }

    @Test
    fun `a drag lands among the planned rows and never among what the player holds`() {
        // History folded: the shown rows start at the one on air, so the planned ones are 2 to 4.
        assertEquals(2..4, RunningOrderUiState(items).dragBounds())
    }

    @Test
    fun `the bounds follow the fold when the history is open`() {
        assertEquals(4..6, RunningOrderUiState(items, historyOpen = true).dragBounds())
    }

    @Test
    fun `there is nothing to drag with fewer than two planned rows`() {
        assertNull(RunningOrderUiState(items.dropLast(2)).dragBounds())
    }
}
