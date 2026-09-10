package com.maroonedsoftware.deadair.playback

import com.maroonedsoftware.deadair.sdk.models.NowPlayingMount
import com.maroonedsoftware.deadair.sdk.models.NowPlayingMountFormat
import com.maroonedsoftware.deadair.station.StreamFormat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Which mount gets played.
 *
 * The paths come from the station rather than being derived here, which is the point: deriving
 * `/live.opus` from `/live.mp3` works until an operator renames the mount, and then fails in a way
 * that looks like the stream being down rather than like a wrong guess.
 */
class MountSelectionTest {
    private fun mount(format: NowPlayingMountFormat, path: String, bitrate: Long? = null) = NowPlayingMount(format, path, bitrate)

    private val published =
        listOf(
            mount(NowPlayingMountFormat.MP3, "/live.mp3", 128),
            mount(NowPlayingMountFormat.AAC, "/live.aac", 192),
            mount(NowPlayingMountFormat.HLS, "/live.m3u8"),
        )

    @Test
    fun `plays the format the listener chose when the station publishes it`() {
        val choice = chooseMount(published, StreamFormat.AAC)

        assertEquals("/live.aac", choice.path)
        assertEquals(StreamFormat.AAC, choice.format)
        assertFalse(choice.fellBack)
    }

    @Test
    fun `falls back to MP3 for a format the operator has not switched on, and says so`() {
        // Quietly giving somebody who chose FLAC a 128k MP3 would be a lie. The flag is what the
        // screen uses to tell them.
        val choice = chooseMount(published, StreamFormat.FLAC)

        assertEquals("/live.mp3", choice.path)
        assertEquals(StreamFormat.MP3, choice.format)
        assertTrue(choice.fellBack)
    }

    @Test
    fun `follows a renamed mount rather than deriving one`() {
        val renamed =
            listOf(
                mount(NowPlayingMountFormat.MP3, "/wireless.mp3", 128),
                mount(NowPlayingMountFormat.OPUS, "/wireless.opus", 160),
            )

        assertEquals("/wireless.opus", chooseMount(renamed, StreamFormat.OPUS).path)
        assertEquals("/wireless.mp3", chooseMount(renamed, StreamFormat.FLAC).path)
    }

    @Test
    fun `guesses the default mount before the station has answered`() {
        // Nothing else is knowable yet, and `/live.mp3` is where a station publishes MP3.
        val choice = chooseMount(emptyList(), StreamFormat.MP3)

        assertEquals("/live.mp3", choice.path)
        assertFalse(choice.fellBack)
    }

    @Test
    fun `marks the guess as a fallback when it is not the chosen format`() {
        val choice = chooseMount(emptyList(), StreamFormat.HLS)

        assertEquals("/live.mp3", choice.path)
        assertTrue(choice.fellBack)
    }

    @Test
    fun `plays something rather than nothing if a station ever omits MP3`() {
        // The contract says the list is never empty and MP3 is first. If that is ever untrue,
        // playing the first mount named beats refusing to play at all.
        val odd = listOf(mount(NowPlayingMountFormat.FLAC, "/only.flac"))

        val choice = chooseMount(odd, StreamFormat.AAC)

        assertEquals("/only.flac", choice.path)
        assertTrue(choice.fellBack)
    }
}
