package com.maroonedsoftware.deadair.ui.order

import com.maroonedsoftware.deadair.sdk.models.StationItemState
import com.maroonedsoftware.deadair.sdk.models.StationOrderItem
import com.maroonedsoftware.deadair.sdk.models.StationOrderItemKind
import com.maroonedsoftware.deadair.sdk.models.StationOrderItemSegmentState
import com.maroonedsoftware.deadair.ui.text.Message

/** Whether an item is beyond editing: the player has it, or it is behind us. */
fun StationOrderItem.isSpent(): Boolean = state != StationItemState.PLANNED

/**
 * The running order as the tab lays it out: the history folded behind a count, the row the order is
 * read from, and the two indices every operator action is stated against.
 *
 * Pure, and the console's rules exactly, so a phone and a desk agree about which row is the anchor
 * and where a move is allowed to land.
 */
data class RunningOrderUiState(val items: List<StationOrderItem>, val historyOpen: Boolean = false) {
    /**
     * Which row the order is read FROM: the item on air when there is one, else the first item
     * nothing has spent. -1 for an order that is entirely behind us.
     */
    val anchorIndex: Int
        get() {
            val airing = items.indexOfFirst { it.state == StationItemState.AIRING }
            if (airing >= 0) return airing
            return items.indexOfFirst { it.state == StationItemState.PLANNED || it.state == StationItemState.HANDED }
        }

    /**
     * The lowest position an item may be moved to, and the only one the tab ever asks for. The
     * station refuses a move below what has been committed rather than clamping it, and the first
     * planned row is always at or above that line. -1 when nothing is planned.
     */
    val firstPlannedIndex: Int get() = items.indexOfFirst { it.state == StationItemState.PLANNED }

    /** How many rows can still be reordered, which is what decides whether Shuffle means anything. */
    val plannedCount: Int get() = items.count { it.state == StationItemState.PLANNED }

    /** Everything before the anchor, by POSITION: a removed item among the planned ones is still ahead. */
    val folded: List<StationOrderItem>
        get() = if (historyOpen || anchorIndex <= 0) emptyList() else items.subList(0, anchorIndex)

    val shown: List<StationOrderItem>
        get() = if (folded.isEmpty()) items else items.subList(anchorIndex, items.size)

    /** Where a shown row sits in the WHOLE order, which is the number a move is stated against. */
    fun positionOf(shownIndex: Int): Int = shownIndex + (items.size - shown.size)

    /** What the fold is called, counting only what it holds. `null` when nothing is folded. */
    val historyLabel: Message?
        get() {
            val rows = folded
            if (rows.isEmpty()) return null
            return Message.FoldedHistory(
                played = rows.count { it.state == StationItemState.PLAYED },
                passed = rows.count { it.state == StationItemState.SKIPPED || it.state == StationItemState.UNAVAILABLE },
            )
        }
}

/** How loud a row is: full for now and next, half for history, a quarter for a skipped break, which arrives in runs. */
fun StationOrderItem.opacity(): Float =
    when {
        state == StationItemState.AIRING || state == StationItemState.PLANNED -> 1f
        state == StationItemState.SKIPPED && segmentId != null -> 0.25f
        else -> 0.5f
    }

/**
 * What the row says about where it has got to, in the console's words. Nothing for a planned
 * record; for a planned break that will not be heard, why not — in three readings rather than one,
 * because "will skip" on nine rows at once said the station was failing when it was working.
 */
fun StationOrderItem.stateLabel(): Message? {
    if (state != StationItemState.PLANNED) return Message.ItemState(state)
    if (kind != StationOrderItemKind.SEGMENT || playable != false) return null
    return when (segmentState) {
        StationOrderItemSegmentState.PLANNED, StationOrderItemSegmentState.WRITING -> Message.NotWrittenYet
        StationOrderItemSegmentState.WRITTEN, StationOrderItemSegmentState.RENDERING -> Message.NoAudioYet
        else -> Message.WillSkip
    }
}
