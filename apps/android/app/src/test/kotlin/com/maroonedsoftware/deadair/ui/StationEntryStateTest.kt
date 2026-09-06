package com.maroonedsoftware.deadair.ui

import com.maroonedsoftware.deadair.station.StationCheck
import com.maroonedsoftware.deadair.ui.settings.StationEntryState
import com.maroonedsoftware.deadair.ui.text.Message
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
        assertEquals(Message.AnsweredAs("Static Between Stations"), state.supportingText)
    }

    @Test
    fun `names the status when something answered and was not a station`() {
        val state = StationEntryState.from("https://example.com", StationCheck.NotAStation(404))

        assertEquals(Message.AnsweredStatus(404), state.error)
    }

    @Test
    fun `says something answered even when there was no status to name`() {
        val state = StationEntryState.from("https://example.com", StationCheck.NotAStation(null))

        assertEquals(Message.NotAStation, state.error)
    }

    @Test
    fun `names the missing field when the station is running an older API`() {
        // The fix is a deploy, not a different address, so the message has to say so.
        val state = StationEntryState.from("https://radio.example.com", StationCheck.Incompatible("mounts"))

        assertEquals(Message.OlderApi("mounts"), state.error)
    }

    @Test
    fun `still explains an unknown shape when it cannot name the field`() {
        val state = StationEntryState.from("https://radio.example.com", StationCheck.Incompatible(null))

        assertEquals(Message.UnknownShape, state.error)
    }

    @Test
    fun `tells a listener to check the network when nothing answered`() {
        val state = StationEntryState.from("https://nope.invalid", StationCheck.Unreachable("dns"))

        assertEquals(Message.CouldNotReach, state.error)
    }

    @Test
    fun `notes cleartext without treating it as an error`() {
        val state = StationEntryState.typing("http://10.0.2.2:8080")

        assertTrue(state.cleartext)
        assertNull(state.error)
        assertEquals(Message.NotEncrypted, state.supportingText)
    }

    @Test
    fun `says nothing about encryption for an https address`() {
        val state = StationEntryState.typing("https://radio.example.com")

        assertEquals(false, state.cleartext)
        assertNull(state.supportingText)
    }

    // ── Whether there is anything to check ───────────────────────────────────────────────

    @Test
    fun `offers nothing to check while the field reads as the address already kept`() {
        // Two taps to achieve nothing: Check, then Use, for an address that was already in use.
        val loaded = StationEntryState.typing("https://radio.example.com", stored = "https://radio.example.com")

        assertFalse(loaded.showsCheck)
    }

    @Test
    fun `offers a check once the address has been edited`() {
        assertTrue(StationEntryState.typing("https://radio.example.com:8443", stored = "https://radio.example.com").showsCheck)
    }

    @Test
    fun `reads a differently written address as the same one when it parses the same`() {
        // A trailing slash, or a bare host that parses to the https origin already kept.
        assertFalse(StationEntryState.typing("https://radio.example.com/", stored = "https://radio.example.com").showsCheck)
        assertFalse(StationEntryState.typing("radio.example.com", stored = "https://radio.example.com").showsCheck)
    }

    @Test
    fun `always offers a check on first run, when nothing is kept yet`() {
        assertTrue(StationEntryState.typing("https://radio.example.com").showsCheck)
        assertTrue(StationEntryState.typing("not an address").showsCheck)
    }

    @Test
    fun `stops offering a check once the address has answered`() {
        val answered = StationEntryState.from("https://radio.example.com:8443", StationCheck.Reachable("Static"), stored = "https://radio.example.com")

        assertFalse(answered.showsCheck)
        assertEquals("https://radio.example.com", answered.stored)
    }

    @Test
    fun `keeps the kept address through typing and through an answer`() {
        val typed = StationEntryState.typing("https://other.example.com", stored = "https://radio.example.com")
        val refused = StationEntryState.from(typed.address, StationCheck.NotAStation(404), typed.stored)
        val invalid = StationEntryState.invalid("nope", typed.stored)

        assertEquals("https://radio.example.com", refused.stored)
        assertEquals("https://radio.example.com", invalid.stored)
        assertEquals(Message.NotAnAddress, invalid.error)
        assertTrue(refused.showsCheck)
    }

    @Test
    fun `typing again drops a verdict that no longer applies to what is in the field`() {
        val confirmed = StationEntryState.from("https://radio.example.com", StationCheck.Reachable("Static"))

        val edited = StationEntryState.typing(confirmed.address + "x")

        assertNull(edited.confirmedName)
        assertNull(edited.error)
    }
}
