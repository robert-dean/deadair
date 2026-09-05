package com.maroonedsoftware.deadair.sdk

import com.maroonedsoftware.deadair.sdk.models.NowPlaying
import com.maroonedsoftware.deadair.sdk.models.NowPlayingMountFormat
import com.maroonedsoftware.deadair.sdk.runtime.SdkJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * That the generated SDK decodes what the station actually answers.
 *
 * The models under `packages/sdk-kotlin` are generated from `nowplaying.types.ck`, so nothing here
 * is testing hand-written code. What it IS testing is the pair of assumptions the whole client
 * rests on: that the generator's reading of that contract matches the API's, and that the decoder
 * is configured to tolerate what a real station sends. Both have been wrong before — the generated
 * Kotlin did not compile at all until the two bugs fixed upstream at 0.1.1.
 *
 * The fixtures are the shapes `NowPlayingService` really produces, one per branch it has.
 */
class NowPlayingDecodeTest {
    @Test
    fun `decodes a station that is on air`() {
        val json =
            """
            {
              "station": "Static Between Stations",
              "onAir": true,
              "listeners": 12,
              "mounts": [
                { "format": "mp3", "path": "/live.mp3", "bitrateKbps": 128 },
                { "format": "flac", "path": "/live.flac" }
              ],
              "track": {
                "title": "Windowlicker",
                "artist": "Aphex Twin",
                "album": "Windowlicker",
                "artworkUrl": "art/2f6c1e9a-0000-4000-8000-000000000001",
                "durationMs": 366000,
                "startedAt": 1700000000000,
                "remainingMs": 120000
              }
            }
            """.trimIndent()

        val now = SdkJson.decodeFromString<NowPlaying>(json)

        assertEquals("Static Between Stations", now.station)
        assertTrue(now.onAir)
        assertEquals(12L, now.listeners)
        assertEquals(NowPlayingMountFormat.MP3, now.mounts[0].format)
        assertEquals("/live.mp3", now.mounts[0].path)
        assertEquals(128L, now.mounts[0].bitrateKbps)
        // FLAC is lossless, so the station reports no rate for it and the field must be absent
        // rather than zero.
        assertNull(now.mounts[1].bitrateKbps)
        assertEquals("Windowlicker", now.track?.title)
        // `startedAt` is epoch millis and overflows a 32-bit Int, which is why the generator maps
        // the contract's `int` to `Long`. A mapping to Int would fail here and nowhere else.
        assertEquals(1_700_000_000_000L, now.track?.startedAt)
    }

    @Test
    fun `decodes a quiet station, which is an ordinary answer and not an error`() {
        // No `track` at all. The station still names its mounts, because a client choosing how to
        // listen has to be able to ask that of a station nobody has tuned into yet.
        val json = """{"station":"Static","onAir":false,"listeners":0,"mounts":[{"format":"mp3","path":"/live.mp3","bitrateKbps":128}]}"""

        val now = SdkJson.decodeFromString<NowPlaying>(json)

        assertEquals(false, now.onAir)
        assertNull(now.track)
        assertEquals(1, now.mounts.size)
    }

    @Test
    fun `decodes a track the catalog could say little about`() {
        // Every optional absent at once. A decoder without defaults on these fields throws here.
        val json =
            """{"station":"S","onAir":true,"listeners":1,"mounts":[],"track":{"title":"Untitled","artist":"","startedAt":42}}"""

        val now = SdkJson.decodeFromString<NowPlaying>(json)

        assertEquals("Untitled", now.track?.title)
        assertNull(now.track?.album)
        assertNull(now.track?.artworkUrl)
        assertNull(now.track?.durationMs)
        assertNull(now.track?.remainingMs)
    }

    @Test
    fun `ignores a field the station grew after this app shipped`() {
        // `ignoreUnknownKeys` in the generated `SdkJson`. The station and the app are versioned
        // separately and an installed phone is not upgraded when the server is, so a new field
        // must not stop an old client reading the rest.
        val json = """{"station":"S","onAir":false,"listeners":0,"mounts":[],"somethingNew":{"a":1}}"""

        assertEquals("S", SdkJson.decodeFromString<NowPlaying>(json).station)
    }

    @Test
    fun `reads the HLS mount, which the playout status has no arm for`() {
        val json = """{"station":"S","onAir":false,"listeners":0,"mounts":[{"format":"hls","path":"/live.m3u8"}]}"""

        val now = SdkJson.decodeFromString<NowPlaying>(json)

        assertEquals(NowPlayingMountFormat.HLS, now.mounts[0].format)
        assertEquals("/live.m3u8", now.mounts[0].path)
    }
}
