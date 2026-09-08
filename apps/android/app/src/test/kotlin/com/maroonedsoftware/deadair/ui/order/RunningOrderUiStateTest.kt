package com.maroonedsoftware.deadair.ui.order

import com.maroonedsoftware.deadair.sdk.models.StationItemState
import com.maroonedsoftware.deadair.sdk.models.StationOrderItem
import com.maroonedsoftware.deadair.sdk.models.StationOrderItemKind
import com.maroonedsoftware.deadair.sdk.models.StationOrderItemSegmentState
import com.maroonedsoftware.deadair.ui.text.Message
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The console's rules for reading the order: where it is read from, what folds away, and where a move may land. */
class RunningOrderUiStateTest {
    private fun item(
        id: String,
        state: StationItemState,
        kind: StationOrderItemKind = StationOrderItemKind.TRACK,
        segmentState: StationOrderItemSegmentState? = null,
        playable: Boolean? = null,
    ) = StationOrderItem(
        id = id,
        kind = kind,
        state = state,
        title = id,
        artists = emptyList(),
        segmentId = if (kind == StationOrderItemKind.SEGMENT) "s-$id" else null,
        segmentState = segmentState,
        playable = playable,
    )

    private val items =
        listOf(
            item("a", StationItemState.PLAYED),
            item("b", StationItemState.SKIPPED, kind = StationOrderItemKind.SEGMENT),
            item("c", StationItemState.PLAYED),
            item("d", StationItemState.AIRING),
            item("e", StationItemState.HANDED),
            item("f", StationItemState.PLANNED),
            item("g", StationItemState.PLANNED),
        )

    @Test
    fun `reads from the item on air`() {
        assertEquals(3, RunningOrderUiState(items).anchorIndex)
    }

    @Test
    fun `reads from the first unspent item when nothing is on air`() {
        val stoodDown = items.map { if (it.state == StationItemState.AIRING) it.copy(state = StationItemState.PLAYED) else it }
        assertEquals(4, RunningOrderUiState(stoodDown).anchorIndex)
    }

    @Test
    fun `folds everything before the anchor and counts what it holds`() {
        val ui = RunningOrderUiState(items)

        assertEquals(listOf("a", "b", "c"), ui.folded.map { it.id })
        assertEquals(listOf("d", "e", "f", "g"), ui.shown.map { it.id })
        assertEquals(Message.FoldedHistory(played = 2, passed = 1), ui.historyLabel)
        // The first shown row is the fourth in the whole order.
        assertEquals(3, ui.positionOf(0))
    }

    @Test
    fun `opening the history shows every row`() {
        val ui = RunningOrderUiState(items, historyOpen = true)

        assertEquals(7, ui.shown.size)
        assertNull(ui.historyLabel)
        assertEquals(0, ui.positionOf(0))
    }

    @Test
    fun `a move may land no lower than the first planned row`() {
        assertEquals(5, RunningOrderUiState(items).firstPlannedIndex)
        assertEquals(2, RunningOrderUiState(items).plannedCount)
    }

    @Test
    fun `a planned record says nothing, and a spent one says where it got to`() {
        assertNull(item("x", StationItemState.PLANNED).stateLabel())
        assertEquals(Message.ItemState(StationItemState.HANDED), item("x", StationItemState.HANDED).stateLabel())
    }

    @Test
    fun `a break that cannot air yet says why, in three readings`() {
        fun segment(state: StationOrderItemSegmentState?) = item("s", StationItemState.PLANNED, StationOrderItemKind.SEGMENT, state, playable = false)

        assertEquals(Message.NotWrittenYet, segment(StationOrderItemSegmentState.WRITING).stateLabel())
        assertEquals(Message.NoAudioYet, segment(StationOrderItemSegmentState.RENDERING).stateLabel())
        assertEquals(Message.WillSkip, segment(StationOrderItemSegmentState.FAILED).stateLabel())
        assertEquals(Message.WillSkip, segment(null).stateLabel())
        // A playable break is an ordinary planned row.
        assertNull(item("s", StationItemState.PLANNED, StationOrderItemKind.SEGMENT, StationOrderItemSegmentState.READY, playable = true).stateLabel())
    }

    @Test
    fun `a skipped break is quieter than a skipped record`() {
        assertEquals(0.25f, item("b", StationItemState.SKIPPED, kind = StationOrderItemKind.SEGMENT).opacity())
        assertEquals(0.5f, item("b", StationItemState.SKIPPED).opacity())
        assertEquals(1f, item("b", StationItemState.PLANNED).opacity())
    }
}
