package com.maroonedsoftware.deadair.ui.plan

import com.maroonedsoftware.deadair.sdk.models.StationMode
import com.maroonedsoftware.deadair.sdk.models.StationOnEnd
import com.maroonedsoftware.deadair.ui.text.Message
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What planning the station sends.
 *
 * The case that earns the most care is the brief on a replan. Absent keeps the words, an empty
 * string clears them, and a string replaces them: three outcomes behind one text box, and the
 * difference between the first two is only whether the operator touched it.
 */
class PlanUiStateTest {
    private fun state(
        scope: PlanScope = PlanScope.KEEP,
        brief: String = "",
        personaId: String? = null,
        eraFrom: String = "",
        eraTo: String = "",
        mode: StationMode = StationMode.ROTATION,
        onEnd: StationOnEnd = StationOnEnd.EXTEND,
        callins: Boolean = false,
        currentBrief: String? = null,
        somethingOn: Boolean = true,
    ) = PlanUiState(
        scope = scope,
        form = PlanForm(brief = brief, personaId = personaId, eraFrom = eraFrom, eraTo = eraTo, mode = mode, onEnd = onEnd, callins = callins),
        currentBrief = currentBrief,
        somethingOn = somethingOn,
    )

    @Test
    fun `nothing on air is not a choice, so the question is not asked`() {
        val off = state(scope = PlanScope.KEEP, somethingOn = false)

        assertFalse(off.showsScope)
        assertFalse(off.keeping)
        // And there is nothing to warn about replacing, because there is nothing on.
        assertFalse(off.warnsReplacing)
    }

    @Test
    fun `keeping is only keeping while something is on`() {
        assertTrue(state(scope = PlanScope.KEEP).keeping)
        assertFalse(state(scope = PlanScope.NEW).keeping)
        assertTrue(state(scope = PlanScope.NEW).warnsReplacing)
    }

    @Test
    fun `a replan of words nobody changed asks for nothing, so the same brief is not rewritten`() {
        val unchanged = state(brief = "heavy metal hits", currentBrief = "heavy metal hits")

        assertNull(unchanged.replanInput().brief)
    }

    @Test
    fun `a stray space around the stored words is not a change`() {
        assertNull(state(brief = "heavy metal hits", currentBrief = "  heavy metal hits  ").replanInput().brief)
    }

    @Test
    fun `new words are sent, trimmed`() {
        assertEquals("warm and unhurried", state(brief = "  warm and unhurried ", currentBrief = "heavy metal hits").replanInput().brief)
    }

    @Test
    fun `clearing a brief that existed sends the empty string, which is what clears it`() {
        assertEquals("", state(brief = "", currentBrief = "heavy metal hits").replanInput().brief)
    }

    @Test
    fun `clearing a brief that never existed asks for nothing`() {
        assertNull(state(brief = "", currentBrief = null).replanInput().brief)
        assertNull(state(brief = "   ", currentBrief = "").replanInput().brief)
    }

    @Test
    fun `a replan never names a count, because the station's own answer is what a phone means`() {
        assertNull(state(brief = "new words", currentBrief = "old").replanInput().count)
    }

    @Test
    fun `replanning is always allowed, because programming the same stretch again is a real want`() {
        assertTrue(state(brief = "", currentBrief = "heavy metal hits").canSubmit)
    }

    @Test
    fun `a new show needs words, which are what it is programmed against and what it is called`() {
        assertFalse(state(scope = PlanScope.NEW, brief = "   ").canSubmit)
        assertTrue(state(scope = PlanScope.NEW, brief = "heavy metal hits").canSubmit)
    }

    @Test
    fun `a year outside the range is an error on its own field`() {
        assertEquals(Message.EraOutOfRange, state(scope = PlanScope.NEW, brief = "x", eraFrom = "1800").eraFromError)
        assertEquals(Message.EraOutOfRange, state(scope = PlanScope.NEW, brief = "x", eraTo = "3000").eraToError)
        assertNull(state(scope = PlanScope.NEW, brief = "x", eraFrom = "1980", eraTo = "1989").eraFromError)
    }

    @Test
    fun `a period that runs backwards is an error on the end, which is the number they meant to change`() {
        val backwards = state(scope = PlanScope.NEW, brief = "x", eraFrom = "1990", eraTo = "1980")

        assertNull(backwards.eraFromError)
        assertEquals(Message.EraBackwards, backwards.eraToError)
        assertFalse(backwards.canSubmit)
    }

    @Test
    fun `a year still being typed blocks the button without shouting about it`() {
        val typing = state(scope = PlanScope.NEW, brief = "x", eraFrom = "19")

        assertNull(typing.eraFromError)
        assertFalse(typing.canSubmit)
    }

    @Test
    fun `an empty period is no bound at all`() {
        val none = state(scope = PlanScope.NEW, brief = "x")

        assertTrue(none.canSubmit)
        assertNull(none.putOnAirInput().eraFrom)
        assertNull(none.putOnAirInput().eraTo)
    }

    @Test
    fun `a new show carries the words as its name, the years as numbers, and the shape as chosen`() {
        val input =
            state(
                scope = PlanScope.NEW,
                brief = " heavy metal hits ",
                personaId = "p-2",
                eraFrom = "1980",
                eraTo = "1989",
                mode = StationMode.FEATURE,
                onEnd = StationOnEnd.STOP,
                callins = true,
            )
                .putOnAirInput()

        assertEquals("heavy metal hits", input.brief)
        assertEquals("heavy metal hits", input.name)
        assertEquals("p-2", input.personaId)
        assertEquals(1980L, input.eraFrom)
        assertEquals(1989L, input.eraTo)
        assertEquals(StationMode.FEATURE, input.mode)
        assertEquals(StationOnEnd.STOP, input.onEnd)
        assertEquals(true, input.callins)
    }

    @Test
    fun `phone-ins are named only when they were asked for, so the station's own setting stands`() {
        assertNull(state(scope = PlanScope.NEW, brief = "x", callins = false).putOnAirInput().callins)
    }

    @Test
    fun `an unchosen host is absent, which means whichever persona the station has on air`() {
        assertNull(state(scope = PlanScope.NEW, brief = "x").putOnAirInput().personaId)
    }

    @Test
    fun `a broadcast planned from words names no playlist and no chart`() {
        val input = state(scope = PlanScope.NEW, brief = "x").putOnAirInput()

        assertNull(input.pluginId)
        assertNull(input.playlistId)
        assertNull(input.chartId)
        assertNull(input.chartOrder)
    }
}
