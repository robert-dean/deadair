package com.maroonedsoftware.deadair.sdk

import com.maroonedsoftware.deadair.sdk.models.HistoryPage
import com.maroonedsoftware.deadair.sdk.runtime.SdkJson
import kotlin.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * That the generated SDK decodes what `GET /history` actually answers.
 *
 * Same argument as `NowPlayingDecodeTest`: the models are generated, so nothing here tests
 * hand-written code, and what it does test is that the generator's reading of `history.types.ck`
 * matches the API's. Two things about this contract are worth pinning rather than assuming.
 *
 * `airedAt` is a `datetime`, which the server sends as ISO-8601 and the generator maps to
 * `kotlin.time.Instant` through the stdlib serializer. Nothing in the app had decoded one before
 * this route existed.
 *
 * The four catalog fields are ABSENT rather than null for a record aired straight from a provider,
 * which is the normal case on a station running no catalog — so the fixture that leaves them out is
 * the shape a listener is most likely to meet, not an edge case.
 */
class HistoryDecodeTest {
    @Test
    fun `decodes a page the catalog could answer for in full`() {
        val json =
            """
            {
              "entries": [
                {
                  "id": "3f2c1e9a-0000-4000-8000-000000000001",
                  "airedAt": "2026-09-06T21:14:05.000Z",
                  "title": "Blue Monday",
                  "artists": "New Order",
                  "album": "Power, Corruption & Lies",
                  "artworkUrl": "art/2f6c1e9a-0000-4000-8000-000000000002",
                  "durationMs": 448000,
                  "trackId": "1a2b3c4d-0000-4000-8000-000000000003"
                }
              ],
              "nextBefore": "2026-09-06T21:14:05.000Z|3f2c1e9a-0000-4000-8000-000000000001"
            }
            """.trimIndent()

        val page = SdkJson.decodeFromString(HistoryPage.serializer(), json)
        val entry = page.entries.single()

        assertEquals(Instant.parse("2026-09-06T21:14:05.000Z"), entry.airedAt)
        assertEquals("Blue Monday", entry.title)
        assertEquals("New Order", entry.artists)
        assertEquals("Power, Corruption & Lies", entry.album)
        assertEquals("art/2f6c1e9a-0000-4000-8000-000000000002", entry.artworkUrl)
        assertEquals(448_000L, entry.durationMs)
        assertEquals("1a2b3c4d-0000-4000-8000-000000000003", entry.trackId)
        assertEquals("2026-09-06T21:14:05.000Z|3f2c1e9a-0000-4000-8000-000000000001", page.nextBefore)
    }

    @Test
    fun `decodes a record the catalog knows nothing about`() {
        val json =
            """
            {
              "entries": [
                {
                  "id": "3f2c1e9a-0000-4000-8000-000000000004",
                  "airedAt": "2026-09-06T20:58:00.000Z",
                  "title": "An Unknown Record",
                  "artists": "Earth, Wind & Fire"
                }
              ]
            }
            """.trimIndent()

        val page = SdkJson.decodeFromString(HistoryPage.serializer(), json)
        val entry = page.entries.single()

        assertNull(entry.album)
        assertNull(entry.artworkUrl)
        assertNull(entry.durationMs)
        assertNull(entry.trackId)
        // The credit line arrives whole. A comma in it is part of the act's name, not a separator.
        assertEquals("Earth, Wind & Fire", entry.artists)
    }

    @Test
    fun `decodes the end of the history, which carries no cursor`() {
        val page = SdkJson.decodeFromString(HistoryPage.serializer(), """{"entries":[]}""")

        assertTrue(page.entries.isEmpty())
        assertNull(page.nextBefore)
    }
}
