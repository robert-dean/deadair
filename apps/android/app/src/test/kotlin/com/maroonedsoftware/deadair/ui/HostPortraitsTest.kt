package com.maroonedsoftware.deadair.ui

import com.maroonedsoftware.deadair.sdk.models.PersonaPortrait
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Which picture belongs to whom: the one lookup What's on and Up next both put a face to a name with. */
@OptIn(ExperimentalUuidApi::class)
class HostPortraitsTest {
    private val cassId = "0b5c6a52-9a3e-4f43-9d0c-6f1f0f0e7a11"
    private val portraits = listOf(PersonaPortrait(personaId = Uuid.parse(cassId), url = "/art/cass"))

    @Test
    fun `finds the portrait filed under a persona`() {
        assertEquals("/art/cass", portraits.portraitPathOf(cassId))
    }

    @Test
    fun `matches the id whatever its case`() {
        assertEquals("/art/cass", portraits.portraitPathOf(cassId.uppercase()))
    }

    @Test
    fun `nobody, a stranger and a blank path all have no portrait`() {
        assertNull(portraits.portraitPathOf(null))
        assertNull(portraits.portraitPathOf(""))
        assertNull(portraits.portraitPathOf("7e0d2f3c-1b4a-4c8e-8f5d-2a9b6c3d4e5f"))
        assertNull(listOf(PersonaPortrait(personaId = Uuid.parse(cassId), url = " ")).portraitPathOf(cassId))
    }
}
