package com.maroonedsoftware.deadair.ui.order

/** Where a row may be moved, stated against the whole order. */
enum class Move { PLAY_NEXT, UP, DOWN }

/**
 * The index a move lands on, or `null` when the move would change nothing or is not allowed.
 *
 * Never below the first planned row: the station refuses a `toIndex` inside what the player holds
 * rather than clamping it, on the grounds that quietly reordering something a listener is about to
 * hear is worse than saying no. A move that would leave the row where it is is no move at all, and
 * a control whose only effect is nothing teaches an operator to ignore it.
 */
fun moveTarget(move: Move, position: Int, firstPlannedIndex: Int, size: Int): Int? {
    if (firstPlannedIndex < 0 || position < firstPlannedIndex) return null
    val target =
        when (move) {
            Move.PLAY_NEXT -> firstPlannedIndex
            Move.UP -> position - 1
            Move.DOWN -> position + 1
        }
    if (target < firstPlannedIndex || target > size - 1 || target == position) return null
    return target
}
