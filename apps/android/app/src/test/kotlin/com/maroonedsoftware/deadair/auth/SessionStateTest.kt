package com.maroonedsoftware.deadair.auth

import com.maroonedsoftware.deadair.station.StationUrl
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Which station a session belongs to.
 *
 * A bearer is issued by one station and means nothing to another, so the question "am I signed in"
 * cannot be answered by the presence of a token alone. Comparing origins rather than clearing the
 * store the moment the address changes is what makes the answer the same whether the change
 * happened a second ago or on the last run.
 */
class SessionStateTest {
    private val station = StationUrl.parse("https://radio.example.com").getOrThrow()

    private fun session(origin: String) =
        StoredSession(origin = origin, email = "operator@example.com", accessToken = "access", refreshToken = "refresh")

    @Test
    fun `a session for this station is signed in`() {
        assertEquals(SessionState.SignedIn("operator@example.com"), sessionFor(session(station.origin), station))
    }

    @Test
    fun `a session for a different station is not`() {
        assertEquals(SessionState.SignedOut, sessionFor(session("https://other.example.com"), station))
    }

    @Test
    fun `the same host on a different scheme is a different station`() {
        // Not pedantry: a listener who switches an install from http to https has pointed the app
        // at a different origin, and the token they hold was issued to the other one.
        assertEquals(SessionState.SignedOut, sessionFor(session("http://radio.example.com"), station))
    }

    @Test
    fun `no session is signed out`() {
        assertEquals(SessionState.SignedOut, sessionFor(null, station))
    }

    @Test
    fun `no station is signed out, whatever is on disk`() {
        assertEquals(SessionState.SignedOut, sessionFor(session(station.origin), null))
    }
}
