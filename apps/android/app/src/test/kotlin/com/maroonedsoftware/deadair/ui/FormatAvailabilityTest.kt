package com.maroonedsoftware.deadair.ui

import com.maroonedsoftware.deadair.sdk.models.NowPlayingMount
import com.maroonedsoftware.deadair.sdk.models.NowPlayingMountFormat
import com.maroonedsoftware.deadair.station.StreamFormat
import com.maroonedsoftware.deadair.ui.settings.availableFormats
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Which formats the picker offers.
 *
 * The rule this is really defending is that the answer comes from the station's own reading and
 * never from connecting to mounts to see which respond — a probe is an audience, and an
 * audience-gated station would be put on air for five minutes by somebody opening settings.
 */
class FormatAvailabilityTest {
    private fun mount(format: NowPlayingMountFormat) = NowPlayingMount(format, "/live", null)

    @Test
    fun `offers what the station publishes and greys what it does not`() {
        val available = availableFormats(listOf(mount(NowPlayingMountFormat.MP3), mount(NowPlayingMountFormat.HLS)))

        assertEquals(true, available[StreamFormat.MP3])
        assertEquals(true, available[StreamFormat.HLS])
        assertEquals(false, available[StreamFormat.OPUS])
        assertEquals(false, available[StreamFormat.FLAC])
        assertEquals(false, available[StreamFormat.AAC])
    }

    @Test
    fun `offers every format before the station has said anything`() {
        // No reading yet. An empty map means "unknown", which the screen reads as offer-everything;
        // greying on no evidence would be a guess presented as fact.
        assertTrue(availableFormats(null).isEmpty())
    }

    @Test
    fun `has an answer for every format the picker can show`() {
        val available = availableFormats(listOf(mount(NowPlayingMountFormat.MP3)))

        assertEquals(StreamFormat.entries.toSet(), available.keys)
    }
}
