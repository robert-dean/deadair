package com.maroonedsoftware.deadair.station

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The desktop's `StationLinkTests`, case for case, so the two apps read one link the same way. The
 * cases past those are Android's own: a user or password in the link, and a fragment.
 */
class StationLinkTest {
    private fun origin(link: String?) = StationLink.parse(link)?.origin

    @Test
    fun `reads the station the console writes`() {
        assertEquals("https://radio.example.com", origin("deadair://connect?station=https%3A%2F%2Fradio.example.com"))
        assertEquals("http://192.168.1.50:8000", origin("deadair://connect?station=http%3A%2F%2F192.168.1.50%3A8000"))
        assertEquals("https://radio.example.com", origin("deadair://connect/?station=https%3A%2F%2Fradio.example.com"))
        assertEquals("https://radio.example.com", origin("deadair://connect?from=console&station=https%3A%2F%2Fradio.example.com"))
        assertEquals("https://radio.example.com", origin("deadair://connect?station=https%3A%2F%2Fradio.example.com&from=console"))
        assertEquals("https://radio.example.com", origin("DEADAIR://connect?station=https%3A%2F%2Fradio.example.com"))
    }

    /** The only form that can name a plain-http station: the shorthand would make it https and point at nothing. */
    @Test
    fun `keeps a plain http station plain`() {
        assertEquals("http://radio.local", origin("deadair://connect?station=http%3A%2F%2Fradio.local"))
    }

    @Test
    fun `reads the shorthand as https`() {
        assertEquals("https://radio.example.com", origin("deadair://radio.example.com"))
        assertEquals("https://radio.example.com", origin("deadair://radio.example.com/"))
        assertEquals("https://radio.example.com:8443", origin("deadair://radio.example.com:8443"))
    }

    @Test
    fun `refuses anything else`() {
        for (link in
            listOf(
                null,
                "",
                "https://radio.example.com",
                "deadair://connect",
                "deadair://connect?station=",
                "deadair://connect?other=1",
                "deadair://connect?station=ftp%3A%2F%2Fradio.example.com",
                "deadair://radio.example.com/some/path",
                "deadair://radio.example.com?station=https%3A%2F%2Felsewhere.example.com",
                "not a link",
            )) {
            assertNull(link, origin(link))
        }
    }

    @Test
    fun `a link never carries a way in`() {
        assertNull(origin("deadair://operator:secret@radio.example.com"))
        assertNull(origin("deadair://connect?station=https%3A%2F%2Foperator%3Asecret%40radio.example.com"))
    }

    @Test
    fun `a bare host in the connect form is not guessed at`() {
        assertNull(origin("deadair://connect?station=radio.example.com"))
    }

    private fun url(text: String) = StationUrl.parse(text).getOrThrow()

    @Test
    fun `a link to another station is a question`() {
        assertEquals("https://elsewhere.example.com", StationLink.proposal(url("https://elsewhere.example.com"), kept = url("https://radio.example.com"))?.origin)
        assertEquals("https://radio.example.com", StationLink.proposal(url("https://radio.example.com"), kept = null)?.origin)
    }

    @Test
    fun `a link to the station already kept is no question at all`() {
        assertNull(StationLink.proposal(url("https://radio.example.com"), kept = url("https://radio.example.com/")))
    }
}
