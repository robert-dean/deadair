package com.maroonedsoftware.deadair.ui

import com.maroonedsoftware.deadair.station.StationCheck
import com.maroonedsoftware.deadair.ui.settings.StationEntryState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the address field says back.
 *
 * Tested because the wording is the part most likely to be wrong and the part hardest to check by
 * looking at a screenshot — and because "not encrypted" has to read as a note rather than as a
 * fault, given that a LAN station has no other option.
 */
class StationEntryStateTest {
    @Test
    fun `shows the station's name once an address has answered`() {
        val state = StationEntryState.from("https://radio.example.com", StationCheck.Reachable("Static Between Stations"))

        assertEquals("Static Between Stations", state.confirmedName)
        assertNull(state.error)
        assertEquals("Answered as Static Between Stations", state.supportingText)
    }

    @Test
    fun `names the status when something answered and was not a station`() {
        val state = StationEntryState.from("https://example.com", StationCheck.NotAStation(404))

        assertNotNull(state.error)
        assertTrue(state.error!!.contains("404"))
    }

    @Test
    fun `says something answered even when there was no status to name`() {
        val state = StationEntryState.from("https://example.com", StationCheck.NotAStation(null))

        assertTrue(state.error!!.contains("not a station"))
    }

    @Test
    fun `tells a listener to check the network when nothing answered`() {
        val state = StationEntryState.from("https://nope.invalid", StationCheck.Unreachable("dns"))

        assertTrue(state.error!!.contains("network"))
    }

    @Test
    fun `notes cleartext without treating it as an error`() {
        val state = StationEntryState.typing("http://10.0.2.2:8080")

        assertTrue(state.cleartext)
        assertNull(state.error)
        assertTrue(state.supportingText!!.contains("Not encrypted"))
    }

    @Test
    fun `says nothing about encryption for an https address`() {
        val state = StationEntryState.typing("https://radio.example.com")

        assertEquals(false, state.cleartext)
        assertNull(state.supportingText)
    }

    @Test
    fun `typing again drops a verdict that no longer applies to what is in the field`() {
        val confirmed = StationEntryState.from("https://radio.example.com", StationCheck.Reachable("Static"))

        val edited = StationEntryState.typing(confirmed.address + "x")

        assertNull(edited.confirmedName)
        assertNull(edited.error)
    }
}
