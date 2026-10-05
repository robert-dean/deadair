package com.maroonedsoftware.deadair.ui.order

import com.maroonedsoftware.deadair.sdk.models.Persona
import com.maroonedsoftware.deadair.sdk.models.PersonaPortrait
import com.maroonedsoftware.deadair.sdk.models.StationItemState
import com.maroonedsoftware.deadair.sdk.models.StationMode
import com.maroonedsoftware.deadair.sdk.models.StationOnEnd
import com.maroonedsoftware.deadair.sdk.models.StationOrder
import com.maroonedsoftware.deadair.sdk.models.StationOrderItem
import com.maroonedsoftware.deadair.sdk.models.StationOrderItemKind
import com.maroonedsoftware.deadair.ui.text.Message
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid
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
@OptIn(ExperimentalUuidApi::class)
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

    private fun persona(id: String, label: String, defaultHost: Boolean = false, djName: String? = null) =
        Persona(id = id, key = id, label = label, style = "warm", djName = djName, defaultHost = defaultHost, presenting = defaultHost)

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
        val ui = BroadcastUiState(order(personaId = "a", personaLabel = "Cass"), listOf(persona("b", "Ash", defaultHost = true)))

        assertEquals(HostLine.Named("Cass"), ui.host)
        assertEquals(Message.Text("Cass"), ui.hostName)
    }

    @Test
    fun `the host is named by what they are called on air, not by their character sheet`() {
        val personas = listOf(persona("a", "Valley girl (eighties)", djName = "Tiffani"), persona("b", "Ash", defaultHost = true, djName = "Ash Moreno"))

        assertEquals(Message.Text("Tiffani"), BroadcastUiState(order(personaId = "a", personaLabel = "Valley girl (eighties)"), personas).hostName)
        assertEquals(Message.Text("Ash Moreno"), BroadcastUiState(order(), personas).hostName)
    }

    @Test
    fun `before the persona list arrives a named host is called by the label the order carries`() {
        assertEquals(Message.Text("Cass"), BroadcastUiState(order(personaId = "a", personaLabel = "Cass"), personas = null).hostName)
    }

    @Test
    fun `a broadcast that named nobody is presented by the station's own host`() {
        val ui = BroadcastUiState(order(), listOf(persona("a", "Ash", defaultHost = true)))

        assertEquals(HostLine.StationsOwn("Ash"), ui.host)
        assertEquals(Message.Text("Ash"), ui.hostName)
    }

    @Test
    fun `before the persona list arrives there is no name, which is not the same as nobody`() {
        val ui = BroadcastUiState(order(), personas = null)

        assertEquals(HostLine.StationsOwn(null), ui.host)
        assertEquals(Message.StationsHost, ui.hostName)
    }

    @Test
    fun `nobody when the station has nobody on air either`() {
        val ui = BroadcastUiState(order(), listOf(persona("a", "Ash")))

        assertEquals(HostLine.Nobody, ui.host)
        assertEquals(Message.NoHost, ui.hostName)
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
        val ui = BroadcastUiState(order(personaId = "a", personaLabel = "Cass"), listOf(persona("a", "Cass"), persona("b", "Ash", defaultHost = true)))

        assertEquals(listOf("Ash", "Cass"), ui.hostChoices.map { it.name })
        assertTrue(ui.hostChoices.single { it.id == "a" }.current)
        assertEquals("Ash", ui.stationsOwnName)
    }

    private val cassId = "0b5c6a52-9a3e-4f43-9d0c-6f1f0f0e7a11"
    private val ashId = "7e0d2f3c-1b4a-4c8e-8f5d-2a9b6c3d4e5f"
    private val portraits =
        listOf(PersonaPortrait(personaId = Uuid.parse(cassId), url = "/art/cass"), PersonaPortrait(personaId = Uuid.parse(ashId), url = "/art/ash"))

    @Test
    fun `the header wears the portrait of the host the broadcast named`() {
        val ui = BroadcastUiState(order(personaId = cassId, personaLabel = "Cass"), listOf(persona(ashId, "Ash", defaultHost = true)), portraits)

        assertEquals("/art/cass", ui.hostPortraitPath)
    }

    @Test
    fun `a broadcast that named nobody wears the station's own host's portrait`() {
        val ui = BroadcastUiState(order(), listOf(persona(cassId, "Cass"), persona(ashId, "Ash", defaultHost = true)), portraits)

        assertEquals("/art/ash", ui.hostPortraitPath)
        // Before the persona list lands there is no knowing who that is, so no face either.
        assertNull(BroadcastUiState(order(), personas = null, portraits = portraits).hostPortraitPath)
    }

    @Test
    fun `no portrait off air, before the list arrives, or for a host without one`() {
        assertNull(BroadcastUiState(order(name = "", items = 0), listOf(persona(ashId, "Ash", defaultHost = true)), portraits).hostPortraitPath)
        assertNull(BroadcastUiState(order(personaId = cassId, personaLabel = "Cass"), emptyList(), portraits = null).hostPortraitPath)
        assertNull(BroadcastUiState(order(personaId = "someone-else", personaLabel = "Bo"), emptyList(), portraits).hostPortraitPath)
        // Named only by label: a portrait is filed under an id, and a label is not one.
        assertNull(BroadcastUiState(order(personaLabel = "Cass"), emptyList(), portraits).hostPortraitPath)
    }
}
