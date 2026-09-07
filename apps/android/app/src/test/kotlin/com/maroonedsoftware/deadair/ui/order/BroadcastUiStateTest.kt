package com.maroonedsoftware.deadair.ui.order

import com.maroonedsoftware.deadair.sdk.models.Persona
import com.maroonedsoftware.deadair.sdk.models.StationItemState
import com.maroonedsoftware.deadair.sdk.models.StationMode
import com.maroonedsoftware.deadair.sdk.models.StationOnEnd
import com.maroonedsoftware.deadair.sdk.models.StationOrder
import com.maroonedsoftware.deadair.sdk.models.StationOrderItem
import com.maroonedsoftware.deadair.sdk.models.StationOrderItemKind
import com.maroonedsoftware.deadair.ui.text.Message
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the broadcast says about itself.
 *
 * The case worth pinning is the one in the middle: a broadcast that named nobody is presented by
 * whoever the station has on air, and before that list arrives the honest answer is that there is
 * no name yet rather than that there is nobody.
 */
class BroadcastUiStateTest {
    private fun item(id: String) =
        StationOrderItem(id = id, kind = StationOrderItemKind.TRACK, state = StationItemState.PLANNED, title = id, artists = emptyList())

    private fun order(name: String = "Heavy metal hits", brief: String? = null, personaId: String? = null, personaLabel: String? = null, items: Int = 2) =
        StationOrder(
            name = name,
            brief = brief,
            personaId = personaId,
            personaLabel = personaLabel,
            mode = StationMode.ROTATION,
            onEnd = StationOnEnd.EXTEND,
            source = "director",
            items = (1..items).map { item("i$it") },
        )

    private fun persona(id: String, label: String, active: Boolean = false) =
        Persona(id = id, key = id, label = label, style = "warm", active = active)

    @Test
    fun `an empty name is no title, which is what the station answers off air`() {
        assertNull(BroadcastUiState(order(name = "", items = 0), personas = emptyList()).title)
        assertEquals("Heavy metal hits", BroadcastUiState(order(), personas = emptyList()).title)
    }

    @Test
    fun `a blank brief is no brief`() {
        assertNull(BroadcastUiState(order(brief = "  "), emptyList()).brief)
        assertEquals("warm and unhurried", BroadcastUiState(order(brief = "warm and unhurried"), emptyList()).brief)
    }

    @Test
    fun `the host is the one the broadcast named`() {
        val ui = BroadcastUiState(order(personaId = "a", personaLabel = "Cass"), listOf(persona("b", "Ash", active = true)))

        assertEquals(HostLine.Named("Cass"), ui.host)
        assertEquals(Message.PresentedBy("Cass"), ui.hostMessage)
    }

    @Test
    fun `a broadcast that named nobody is presented by the station's own host`() {
        val ui = BroadcastUiState(order(), listOf(persona("a", "Ash", active = true)))

        assertEquals(HostLine.StationsOwn("Ash"), ui.host)
        assertEquals(Message.PresentedBy("Ash"), ui.hostMessage)
    }

    @Test
    fun `before the persona list arrives there is no name, which is not the same as nobody`() {
        val ui = BroadcastUiState(order(), personas = null)

        assertEquals(HostLine.StationsOwn(null), ui.host)
        assertEquals(Message.PresentedByStationsHost, ui.hostMessage)
    }

    @Test
    fun `nobody when the station has nobody on air either`() {
        val ui = BroadcastUiState(order(), listOf(persona("a", "Ash")))

        assertEquals(HostLine.Nobody, ui.host)
        assertEquals(Message.PresentedByNobody, ui.hostMessage)
    }

    @Test
    fun `nothing on air cannot be recast, and the station says so with an empty name`() {
        assertFalse(BroadcastUiState(order(name = "", items = 0), emptyList()).canRecast)
        assertTrue(BroadcastUiState(order(), emptyList()).canRecast)
    }

    @Test
    fun `a broadcast that has run out of records is still a broadcast`() {
        // Between programmes the station answers with the name, the brief and the host it still
        // has, and an empty list. That is the moment an operator most wants to change either.
        val ui = BroadcastUiState(order(brief = "warm and unhurried", items = 0), emptyList())

        assertTrue(ui.canRecast)
        assertEquals("Heavy metal hits", ui.title)
        assertEquals("warm and unhurried", ui.brief)
    }

    @Test
    fun `handing back to the station's host is offered only where the broadcast named somebody`() {
        assertFalse(BroadcastUiState(order(), emptyList()).stationsOwnEnabled)
        assertTrue(BroadcastUiState(order(personaId = "a", personaLabel = "Cass"), emptyList()).stationsOwnEnabled)
    }

    @Test
    fun `the picker is offered the station's characters, without the broadcast's own`() {
        val ui = BroadcastUiState(order(personaId = "a", personaLabel = "Cass"), listOf(persona("a", "Cass"), persona("b", "Ash", active = true)))

        assertEquals(listOf("Ash", "Cass"), ui.hostChoices.map { it.name })
        assertTrue(ui.hostChoices.single { it.id == "a" }.current)
        assertEquals("Ash", ui.stationsOwnName)
    }
}
