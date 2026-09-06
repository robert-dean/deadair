package com.maroonedsoftware.deadair.ui.order

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Where a move may land: never below the first planned row, and never where the row already is. */
class MoveTargetTest {
    // Ten rows; the first three are spent, so planned rows start at 3.
    private val first = 3
    private val size = 10

    @Test
    fun `play next lands on the first planned row`() {
        assertEquals(3, moveTarget(Move.PLAY_NEXT, position = 7, firstPlannedIndex = first, size = size))
    }

    @Test
    fun `play next is no move for the row already at the front`() {
        assertNull(moveTarget(Move.PLAY_NEXT, position = 3, firstPlannedIndex = first, size = size))
    }

    @Test
    fun `up and down step by one and stop at the edges`() {
        assertEquals(6, moveTarget(Move.UP, position = 7, firstPlannedIndex = first, size = size))
        assertEquals(8, moveTarget(Move.DOWN, position = 7, firstPlannedIndex = first, size = size))
        // Up from the front would land inside what the player holds.
        assertNull(moveTarget(Move.UP, position = 3, firstPlannedIndex = first, size = size))
        assertNull(moveTarget(Move.DOWN, position = 9, firstPlannedIndex = first, size = size))
    }

    @Test
    fun `a spent row, or an order with nothing planned, has no moves`() {
        assertNull(moveTarget(Move.DOWN, position = 1, firstPlannedIndex = first, size = size))
        assertNull(moveTarget(Move.PLAY_NEXT, position = 1, firstPlannedIndex = -1, size = size))
    }
}
