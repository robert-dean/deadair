package com.maroonedsoftware.deadair.ui

import com.maroonedsoftware.deadair.playback.SleepState
import com.maroonedsoftware.deadair.ui.nowplaying.sleepLine
import com.maroonedsoftware.deadair.ui.text.Message
import com.maroonedsoftware.deadair.ui.text.Span
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** What the countdown under the play button says. */
class SleepUiTest {
    @Test
    fun `rounds the countdown up so it never says zero while music is playing`() {
        assertEquals(Message.StopsIn(Span.Minutes(15)), sleepLine(SleepState.Until(deadlineMs = 15 * 60_000L), nowMs = 0))
        assertEquals(Message.StopsIn(Span.Minutes(15)), sleepLine(SleepState.Until(deadlineMs = 15 * 60_000L), nowMs = 1))
        assertEquals(Message.StopsIn(Span.Minutes(1)), sleepLine(SleepState.Until(deadlineMs = 40_000), nowMs = 0))
        assertEquals(Message.StopsIn(Span.Minutes(1)), sleepLine(SleepState.Until(deadlineMs = 40_000), nowMs = 90_000))
    }

    @Test
    fun `an hour reads as an hour`() {
        assertEquals(Message.StopsIn(Span.Hours(1, 0)), sleepLine(SleepState.Until(deadlineMs = 60 * 60_000L), nowMs = 0))
    }

    @Test
    fun `after this record says so whatever the deadline`() {
        assertEquals(Message.StopsAfterThisRecord, sleepLine(SleepState.AfterRecord(deadlineMs = null), nowMs = 0))
        assertEquals(Message.StopsAfterThisRecord, sleepLine(SleepState.AfterRecord(deadlineMs = 10_000), nowMs = 0))
    }

    @Test
    fun `off says nothing`() {
        assertNull(sleepLine(SleepState.Off, nowMs = 0))
    }
}
