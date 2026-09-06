package com.maroonedsoftware.deadair.ui

import com.maroonedsoftware.deadair.sdk.models.Persona
import com.maroonedsoftware.deadair.sdk.models.ScheduleNow
import com.maroonedsoftware.deadair.sdk.models.ScheduleOccurrence
import com.maroonedsoftware.deadair.sdk.models.ScheduleSlot
import com.maroonedsoftware.deadair.sdk.models.ScheduleSlotMode
import com.maroonedsoftware.deadair.sdk.models.ScheduleSlotOnEnd
import com.maroonedsoftware.deadair.ui.schedule.OnNow
import com.maroonedsoftware.deadair.ui.schedule.whatsOn
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the schedule tab says.
 *
 * Which block is ON and which is merely NEXT is one string comparison, and getting it backwards
 * would show a listener a show that has not started as the one they are hearing. The takeover
 * wording is the other half: an operator's own choice holds until the next slot begins, so the
 * schedule can want something the station is not doing, and the eyebrow is where that is said.
 */
class WhatsOnUiStateTest {
    private val now = "2026-09-06 20:30:00"

    private fun block(slotId: String, label: String, start: String, end: String) =
        ScheduleOccurrence(slotId = slotId, label = label, start = start, end = end)

    private fun slot(id: String, personaId: String? = null, brief: String? = null) =
        ScheduleSlot(
            id = id,
            label = "Slot $id",
            startsAtMinutes = 0,
            endsAtMinutes = 60,
            personaId = personaId,
            brief = brief,
            mode = ScheduleSlotMode.ROTATION,
            onEnd = ScheduleSlotOnEnd.EXTEND,
        )

    private fun persona(id: String, label: String, djName: String? = null) =
        Persona(id = id, key = "key-$id", label = label, style = "warm", djName = djName, active = true)

    private val evening = block("slot-1", "Late Night", "2026-09-06 20:00:00", "2026-09-06 22:00:00")
    private val next = block("slot-2", "Small Hours", "2026-09-06 22:00:00", "2026-09-07 00:00:00")
    private val after = block("slot-3", "Dawn", "2026-09-07 06:00:00", "2026-09-07 08:00:00")

    @Test
    fun `the first block is on air only once it has started`() {
        val state = whatsOn(ScheduleNow(now = now, slotId = "slot-1", airingSlotId = "slot-1", upcoming = listOf(evening, next)), emptyList(), emptyList())

        val live = state.onNow as OnNow.Live
        assertEquals("On air", live.eyebrow)
        assertEquals("Late Night", live.block.label)
        assertEquals("1 h 30 min left", live.leftLabel)
        // Thirty minutes into two hours.
        assertEquals(0.25f, live.progress, 0.001f)
    }

    @Test
    fun `a block that has not started yet is next, not on`() {
        val state = whatsOn(ScheduleNow(now = now, upcoming = listOf(next, after)), emptyList(), emptyList())

        assertTrue(state.onNow is OnNow.Between)
        assertEquals(listOf("Up next", "After that"), state.ahead.map { it.eyebrow })
        assertEquals("Small Hours", state.ahead.first().block.label)
        assertEquals("in 1 h 30 min", state.ahead.first().startsIn)
    }

    @Test
    fun `says due now rather than on air while an operator holds the station`() {
        val state =
            whatsOn(
                ScheduleNow(now = now, slotId = "slot-1", airingSlotId = "slot-9", upcoming = listOf(evening)),
                emptyList(),
                emptyList(),
            )

        val live = state.onNow as OnNow.Live
        assertEquals("Due now", live.eyebrow)
        assertTrue(live.takenOver)
    }

    @Test
    fun `a station put on by hand belongs to no slot, which is the commonest takeover of all`() {
        // `airingSlotId` absent is the ordinary shape of it: a broadcast started before there was a
        // schedule was never claimed by a slot.
        val state = whatsOn(ScheduleNow(now = now, slotId = "slot-1", upcoming = listOf(evening)), emptyList(), emptyList())

        assertTrue((state.onNow as OnNow.Live).takenOver)
    }

    @Test
    fun `a station with no schedule at all is not a takeover`() {
        val state = whatsOn(ScheduleNow(now = now, upcoming = listOf(evening)), emptyList(), emptyList())

        assertEquals("On air", (state.onNow as OnNow.Live).eyebrow)
    }

    @Test
    fun `a gap says how long the sustaining source has`() {
        val state = whatsOn(ScheduleNow(now = now, upcoming = listOf(next)), emptyList(), emptyList())

        val between = state.onNow as OnNow.Between
        assertEquals("The station is on its sustaining source for the next 1 h 30 min.", between.detail)
    }

    @Test
    fun `a station with nothing due says so without a countdown`() {
        val state = whatsOn(ScheduleNow(now = now, upcoming = emptyList()), emptyList(), emptyList())

        val between = state.onNow as OnNow.Between
        assertEquals("No block is due from here on, so the station stays on whatever it is set to sustain on.", between.detail)
        assertTrue(state.ahead.isEmpty())
    }

    @Test
    fun `names the host by the name they are introduced under`() {
        // Not the persona's label, which is what the operator filed them under. A listener knows
        // the voice, and the console makes the other choice because it is a filing cabinet.
        val state =
            whatsOn(
                ScheduleNow(now = now, upcoming = listOf(evening)),
                listOf(slot("slot-1", personaId = "p-1", brief = "slow records")),
                listOf(persona("p-1", label = "Night persona", djName = "Cass")),
            )

        val live = state.onNow as OnNow.Live
        assertEquals("Cass", live.block.host)
        assertEquals("slow records", live.block.brief)
        assertEquals("20:00–22:00", live.block.hours)
    }

    @Test
    fun `falls back to the persona's own label where there is no dj name`() {
        val state =
            whatsOn(
                ScheduleNow(now = now, upcoming = listOf(evening)),
                listOf(slot("slot-1", personaId = "p-1")),
                listOf(persona("p-1", label = "Night persona")),
            )

        assertEquals("Night persona", (state.onNow as OnNow.Live).block.host)
    }

    @Test
    fun `leaves the host out when the slot names nobody`() {
        val state = whatsOn(ScheduleNow(now = now, upcoming = listOf(evening)), listOf(slot("slot-1")), emptyList())

        assertNull((state.onNow as OnNow.Live).block.host)
    }

    @Test
    fun `gives an unnamed block something to be called`() {
        val unnamed = block("slot-1", "", "2026-09-06 20:00:00", "2026-09-06 22:00:00")
        val state = whatsOn(ScheduleNow(now = now, upcoming = listOf(unnamed)), emptyList(), emptyList())

        assertEquals("Untitled", (state.onNow as OnNow.Live).block.label)
    }

    @Test
    fun `shows at most two blocks ahead`() {
        val state =
            whatsOn(
                ScheduleNow(now = now, upcoming = listOf(evening, next, after, block("slot-4", "Morning", "2026-09-07 09:00:00", "2026-09-07 11:00:00"))),
                emptyList(),
                emptyList(),
            )

        assertEquals(2, state.ahead.size)
        assertEquals(listOf("Small Hours", "Dawn"), state.ahead.map { it.block.label })
    }

    @Test
    fun `a block with no length reads as not started rather than as finished`() {
        val zero = block("slot-1", "Glitch", "2026-09-06 20:00:00", "2026-09-06 20:00:00")
        val state = whatsOn(ScheduleNow(now = now, upcoming = listOf(zero)), emptyList(), emptyList())

        assertEquals(0f, (state.onNow as OnNow.Live).progress, 0.001f)
    }

    @Test
    fun `never fills the bar past full, however late the reading is`() {
        val over = block("slot-1", "Overrun", "2026-09-06 18:00:00", "2026-09-06 19:00:00")
        val state = whatsOn(ScheduleNow(now = now, upcoming = listOf(over)), emptyList(), emptyList())

        assertEquals(1f, (state.onNow as OnNow.Live).progress, 0.001f)
    }
}
