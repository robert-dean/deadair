package com.maroonedsoftware.deadair.ui.order

/** This list with the item at [from] taken out and put back in at [to], which is how a dragged row lands. */
fun <T> List<T>.moved(from: Int, to: Int): List<T> {
    if (from == to || from !in indices || to !in indices) return this
    return toMutableList().apply { add(to, removeAt(from)) }
}

/**
 * The shown rows a dragged row may land on: from the first planned row to the end. `null` when
 * fewer than two rows are planned, since then there is nowhere to drag one to.
 *
 * The same floor the menu's moves keep (see [moveTarget]): nothing lands among what the player has
 * already been handed, because the station refuses such a move rather than clamping it.
 */
fun RunningOrderUiState.dragBounds(): IntRange? {
    if (plannedCount < 2) return null
    val first = firstPlannedIndex - (items.size - shown.size)
    if (first < 0) return null
    return first..shown.lastIndex
}
