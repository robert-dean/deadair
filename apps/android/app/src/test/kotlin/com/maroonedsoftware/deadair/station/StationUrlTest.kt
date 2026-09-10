package com.maroonedsoftware.deadair.station

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The address a listener types, and everything derived from it.
 *
 * All of it is derivation rather than configuration, because one origin serves the console, the
 * API under `/api` and the mounts beside it. So a mistake here is not a wrong setting, it is every
 * address in the app being wrong at once.
 */
class StationUrlTest {
    private fun parse(input: String) = StationUrl.parse(input).getOrThrow()

    @Test
    fun `assumes https when no scheme is typed`() {
        // The safer guess. A station on the public internet is https, and a listener on a LAN
        // types four more characters.
        assertEquals("https://radio.example.com", parse("radio.example.com").origin)
    }

    @Test
    fun `keeps http, because a LAN station has no other option`() {
        // TLS terminates outside the container, so an operator who has put no proxy in front is
        // reachable only this way. Refusing it would refuse the commonest install.
        assertEquals("http://10.0.2.2:8080", parse("http://10.0.2.2:8080").origin)
    }

    @Test
    fun `drops a trailing slash so nothing downstream builds a double one`() {
        assertEquals("https://radio.example.com", parse("https://radio.example.com/").origin)
        assertEquals("https://radio.example.com/api", parse("https://radio.example.com").apiBase)
    }

    @Test
    fun `keeps a path, because a station may be mounted under one`() {
        val station = parse("https://example.com/radio/")

        assertEquals("https://example.com/radio", station.origin)
        assertEquals("https://example.com/radio/api", station.apiBase)
        assertEquals("https://example.com/radio/live.mp3", station.mountUrl("/live.mp3"))
    }

    @Test
    fun `drops a query and fragment, so pasting the console's address bar works`() {
        assertEquals("https://radio.example.com/desk", parse("https://radio.example.com/desk?tab=queue#now").origin)
    }

    @Test
    fun `refuses what is not an address`() {
        assertTrue(StationUrl.parse("").isFailure)
        assertTrue(StationUrl.parse("   ").isFailure)
        assertTrue(StationUrl.parse("ftp://radio.example.com").isFailure)
        assertTrue(StationUrl.parse("https://").isFailure)
    }

    @Test
    fun `builds a mount URL whether or not the reported path has a leading slash`() {
        val station = parse("https://radio.example.com")

        // `mounts[]` carries the slash, but an older station's `stream.mount` was text an operator typed.
        assertEquals("https://radio.example.com/live.mp3", station.mountUrl("/live.mp3"))
        assertEquals("https://radio.example.com/live.mp3", station.mountUrl("live.mp3"))
    }

    @Test
    fun `passes an absolute artwork URL through untouched`() {
        // Art nothing has cached yet is at the provider's own CDN, and prefixing that with the
        // station would produce an address on neither.
        val station = parse("https://radio.example.com")
        val cdn = "https://i.scdn.co/image/ab67616d"

        assertEquals(cdn, station.artUrl(cdn))
    }

    @Test
    fun `resolves relative artwork against the API root, not the origin`() {
        // `art/<uuid>` is a path under the API's own root. The API mounts its routers at the root
        // and knows nothing about the `/api` prefix the edge adds, so adding it is this side's job.
        val station = parse("https://radio.example.com")

        assertEquals("https://radio.example.com/api/art/abc", station.artUrl("art/abc"))
        assertEquals("https://radio.example.com/api/art/abc", station.artUrl("/art/abc"))
    }

    @Test
    fun `has no artwork URL for a track with no art`() {
        val station = parse("https://radio.example.com")

        assertNull(station.artUrl(null))
        assertNull(station.artUrl(""))
    }
}
