package com.maroonedsoftware.deadair.playback

import androidx.media3.common.Player
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Which buttons a head unit is allowed to draw.
 *
 * The rule worth pinning is the one about the next control: it is the operator's Skip, it ends the
 * record for everybody listening, and it is offered to nobody else.
 */
class LiveCommandsTest {
    private fun withdraws(canSkip: Boolean, command: Int) = withdrawnCommands(canSkip).any { it == command }

    @Test
    fun `a live stream has no position, whoever is signed in`() {
        for (canSkip in listOf(false, true)) {
            assertTrue(withdraws(canSkip, Player.COMMAND_SEEK_BACK))
            assertTrue(withdraws(canSkip, Player.COMMAND_SEEK_FORWARD))
            assertTrue(withdraws(canSkip, Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM))
            assertTrue(withdraws(canSkip, Player.COMMAND_SEEK_TO_DEFAULT_POSITION))
            assertTrue(withdraws(canSkip, Player.COMMAND_SET_SPEED_AND_PITCH))
        }
    }

    @Test
    fun `a live stream has no queue either, so previous and next-item never appear`() {
        for (canSkip in listOf(false, true)) {
            assertTrue(withdraws(canSkip, Player.COMMAND_SEEK_TO_PREVIOUS))
            assertTrue(withdraws(canSkip, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM))
            assertTrue(withdraws(canSkip, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM))
            assertTrue(withdraws(canSkip, Player.COMMAND_SEEK_TO_MEDIA_ITEM))
        }
    }

    @Test
    fun `the next control appears only for an account that may skip`() {
        assertTrue(withdraws(canSkip = false, command = Player.COMMAND_SEEK_TO_NEXT))
        assertFalse(withdraws(canSkip = true, command = Player.COMMAND_SEEK_TO_NEXT))
    }

    @Test
    fun `play and pause are never withdrawn, because a headset's pause key arrives as one`() {
        for (canSkip in listOf(false, true)) {
            assertFalse(withdraws(canSkip, Player.COMMAND_PLAY_PAUSE))
        }
    }
}
