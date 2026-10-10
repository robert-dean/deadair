package com.maroonedsoftware.deadair.sdk

import com.maroonedsoftware.deadair.sdk.models.NowPlayingLyrics
import com.maroonedsoftware.deadair.sdk.models.TrackLyricsKind
import com.maroonedsoftware.deadair.sdk.runtime.SdkJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * That the generated SDK decodes what `/nowplaying/lyrics` answers. The fixtures are the shapes
 * `LyricsReadService.getNowPlayingLyrics` produces, one per branch it has.
 */
class NowPlayingLyricsDecodeTest {
    @Test
    fun `decodes a measured record with timed lines`() {
        val json =
            """
            {
              "onAir": true,
              "trackId": "33333333-3333-4333-8333-333333333333",
              "startedAt": 1790000000000,
              "cueInMs": 1500,
              "cueOutMs": 238001,
              "lyrics": {
                "trackId": "33333333-3333-4333-8333-333333333333",
                "kind": "words",
                "provider": "deadair.lrclib",
                "synced": [ { "atMs": 9000, "text": "first words" }, { "atMs": 12000, "endMs": 14000, "text": "" } ],
                "language": "en"
              }
            }
            """.trimIndent()

        val answer = SdkJson.decodeFromString<NowPlayingLyrics>(json)

        assertEquals(1_790_000_000_000L, answer.startedAt)
        assertEquals(238_001L, answer.cueOutMs)
        assertEquals(TrackLyricsKind.WORDS, answer.lyrics?.kind)
        assertEquals("first words", answer.lyrics?.synced?.first()?.text)
        assertEquals(14_000L, answer.lyrics?.synced?.get(1)?.endMs)
    }

    @Test
    fun `decodes a break, with nothing but the airing`() {
        val answer = SdkJson.decodeFromString<NowPlayingLyrics>("""{ "onAir": true, "startedAt": 1790000000000 }""")
        assertNull(answer.trackId)
        assertNull(answer.lyrics)
    }

    @Test
    fun `decodes off air`() {
        val answer = SdkJson.decodeFromString<NowPlayingLyrics>("""{ "onAir": false }""")
        assertFalse(answer.onAir)
        assertNull(answer.startedAt)
    }

    @Test
    fun `decodes a record no source has words for`() {
        val json =
            """{ "onAir": true, "trackId": "33333333-3333-4333-8333-333333333333", "startedAt": 1, "lyrics": { "trackId": "33333333-3333-4333-8333-333333333333", "kind": "none" } }"""
        assertEquals(TrackLyricsKind.NONE, SdkJson.decodeFromString<NowPlayingLyrics>(json).lyrics?.kind)
    }
}
