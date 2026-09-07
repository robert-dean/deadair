package com.maroonedsoftware.deadair.ui.order

import com.maroonedsoftware.deadair.sdk.models.Persona
import com.maroonedsoftware.deadair.sdk.models.PersonaKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Who a broadcast may be handed to, and what each of them is called. */
class HostChoicesTest {
    private fun persona(id: String, label: String, kind: PersonaKind? = null, djName: String? = null, active: Boolean = false) =
        Persona(id = id, key = id, kind = kind, label = label, style = "warm", djName = djName, active = active)

    @Test
    fun `a caller is never offered, because one can never be put on air`() {
        val choices = hostChoicesOf(listOf(persona("a", "Cass"), persona("b", "Ringer", kind = PersonaKind.CALLER)), currentId = null)

        assertEquals(listOf("Cass"), choices.map { it.name })
    }

    @Test
    fun `an absent kind is a host, which is what most stored personas leave blank`() {
        assertEquals(1, hostChoicesOf(listOf(persona("a", "Cass", kind = null)), currentId = null).size)
        assertEquals(1, hostChoicesOf(listOf(persona("a", "Cass", kind = PersonaKind.HOST)), currentId = null).size)
    }

    @Test
    fun `sorted by label whatever its case`() {
        val choices = hostChoicesOf(listOf(persona("a", "zoe"), persona("b", "Ash"), persona("c", "cass")), currentId = null)

        assertEquals(listOf("Ash", "cass", "zoe"), choices.map { it.name })
    }

    @Test
    fun `marks the one the station has on air and the one already presenting`() {
        val choices = hostChoicesOf(listOf(persona("a", "Ash", active = true), persona("b", "Cass")), currentId = "b")

        assertTrue(choices.single { it.id == "a" }.onAir)
        assertTrue(choices.single { it.id == "b" }.current)
        assertTrue(!choices.single { it.id == "a" }.current)
    }

    @Test
    fun `the on-air name rides along only when it says something the label does not`() {
        val choices = hostChoicesOf(listOf(persona("a", "Ash", djName = "Ash"), persona("b", "Cass", djName = "Cassie"), persona("c", "Ray", djName = " ")), currentId = null)

        assertNull(choices.single { it.id == "a" }.djName)
        assertEquals("Cassie", choices.single { it.id == "b" }.djName)
        assertNull(choices.single { it.id == "c" }.djName)
    }

    @Test
    fun `the station's own host is the active one`() {
        val personas = listOf(persona("a", "Ash"), persona("b", "Cass", active = true))

        assertEquals("Cass", personas.activeHost()?.label)
        assertNull(listOf(persona("a", "Ash")).activeHost())
    }
}
