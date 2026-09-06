package com.maroonedsoftware.deadair.ui

import com.maroonedsoftware.deadair.sdk.models.SilenceCause
import com.maroonedsoftware.deadair.sdk.models.SilenceCheck
import com.maroonedsoftware.deadair.sdk.models.SilenceState
import com.maroonedsoftware.deadair.sdk.models.StationSilence
import com.maroonedsoftware.deadair.ui.nowplaying.Remedy
import com.maroonedsoftware.deadair.ui.nowplaying.SilenceTone
import com.maroonedsoftware.deadair.ui.nowplaying.readSilence
import com.maroonedsoftware.deadair.ui.text.Message
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The console's reading, carried over whole. The rule worth pinning is the one about not deciding:
 * the tone comes from the station's own verdict on the blocking check, never from this file's
 * opinion of the cause.
 */
class SilenceReadingTest {
    private fun check(code: SilenceCause, state: SilenceState, remedy: String? = null) = SilenceCheck(code = code, state = state, detail = "$code: $state", remedy = remedy)

    private fun silence(cause: SilenceCause, audible: Boolean = false, remedy: String? = null, vararg checks: SilenceCheck) =
        StationSilence(audible = audible, cause = cause, detail = "the station's sentence", remedy = remedy, checks = checks.toList())

    @Test
    fun `audible is live whatever the checks say`() {
        val reading = readSilence(silence(SilenceCause.AIRING, audible = true, checks = arrayOf(check(SilenceCause.CONFIG_NOT_ADOPTED, SilenceState.FAULT))))

        assertEquals(SilenceTone.LIVE, reading.tone)
        assertTrue(reading.live)
        assertEquals(Message.SilenceLabel(SilenceCause.AIRING), reading.label)
        // The fault it is not blaming still wants saying.
        assertEquals(listOf(SilenceCause.CONFIG_NOT_ADOPTED), reading.otherFaults.map { it.code })
    }

    @Test
    fun `waiting for a listener is standby, not a fault`() {
        val reading = readSilence(silence(SilenceCause.NO_AUDIENCE, checks = arrayOf(check(SilenceCause.NO_AUDIENCE, SilenceState.WAITING))))

        assertEquals(SilenceTone.STANDBY, reading.tone)
        assertEquals(Message.SilenceTitle(SilenceCause.NO_AUDIENCE), reading.title)
    }

    @Test
    fun `stood down is off, because somebody did it on purpose`() {
        assertEquals(SilenceTone.OFF, readSilence(silence(SilenceCause.STOOD_DOWN, checks = arrayOf(check(SilenceCause.STOOD_DOWN, SilenceState.WAITING)))).tone)
    }

    @Test
    fun `any other waiting gate is standby without this file hearing about it`() {
        assertEquals(SilenceTone.STANDBY, readSilence(silence(SilenceCause.WARMING_UP, checks = arrayOf(check(SilenceCause.WARMING_UP, SilenceState.WAITING)))).tone)
    }

    @Test
    fun `a blocking check the station calls a fault is a fault`() {
        assertEquals(SilenceTone.FAULT, readSilence(silence(SilenceCause.STREAM_UNREACHABLE, checks = arrayOf(check(SilenceCause.STREAM_UNREACHABLE, SilenceState.FAULT)))).tone)
    }

    @Test
    fun `a cause with no matching check is a fault rather than a guess`() {
        assertEquals(SilenceTone.FAULT, readSilence(silence(SilenceCause.NOT_DRIVING)).tone)
    }

    @Test
    fun `sorts the checks into blamed, unblamed and ruled out`() {
        val reading =
            readSilence(
                silence(
                    SilenceCause.STARVED,
                    checks =
                        arrayOf(
                            check(SilenceCause.STREAM_UNREACHABLE, SilenceState.OK),
                            check(SilenceCause.STARVED, SilenceState.FAULT),
                            check(SilenceCause.CONFIG_NOT_ADOPTED, SilenceState.FAULT),
                            check(SilenceCause.NO_AUDIENCE, SilenceState.OK),
                        ),
                ),
            )

        assertEquals(listOf(SilenceCause.CONFIG_NOT_ADOPTED), reading.otherFaults.map { it.code })
        assertEquals(listOf(SilenceCause.STREAM_UNREACHABLE, SilenceCause.NO_AUDIENCE), reading.ruledOut.map { it.code })
        assertEquals("the station's sentence", reading.detail)
    }

    @Test
    fun `a remedy that is a docker command is offered as one`() {
        assertTrue(readSilence(silence(SilenceCause.CONFIG_NOT_ADOPTED, remedy = "docker compose restart liquidsoap")).remedy!!.isCommand)
        assertFalse(Remedy("Put something on the running order.").isCommand)
        assertNull(readSilence(silence(SilenceCause.NO_AUDIENCE)).remedy)
    }
}
