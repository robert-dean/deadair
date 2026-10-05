package com.maroonedsoftware.deadair.nowplaying

import com.maroonedsoftware.deadair.sdk.models.NowPlaying
import com.maroonedsoftware.deadair.sdk.models.NowPlayingShow
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrack
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrackKind
import com.maroonedsoftware.deadair.station.StationUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Which picture stands for what is on air: the record's cover, or during a break the presenter.
 * Absent a portrait, nothing changes from before it existed.
 */
class CoverPathTest {
    private val record = NowPlayingTrack(title = "Windowlicker", artist = "Aphex Twin", artworkUrl = "art/record", startedAt = 1)
    private val spoken = NowPlayingTrack(kind = NowPlayingTrackKind.BREAK, title = "Top of the hour", artist = "", startedAt = 1)
    private val cass = NowPlayingShow(name = "Late Static", host = "Cass", hostArtUrl = "art/cass")

    private fun now(track: NowPlayingTrack?, show: NowPlayingShow? = cass) =
        NowPlaying(station = "S", onAir = track != null, listeners = 0, mounts = emptyList(), show = show, track = track)

    @Test
    fun `is the record's cover while a record plays, whoever is presenting`() {
        assertEquals("art/record", now(record).coverPath())
    }

    @Test
    fun `is the presenter's portrait during a break`() {
        assertEquals("art/cass", now(spoken).coverPath())
    }

    @Test
    fun `keeps a break's own picture if the station ever sends one`() {
        assertEquals("art/break", now(spoken.copy(artworkUrl = "art/break")).coverPath())
    }

    @Test
    fun `is nothing for a record with no cover, rather than the presenter`() {
        // A face over a record would read as the record's artist.
        assertNull(now(record.copy(artworkUrl = null)).coverPath())
    }

    @Test
    fun `is nothing during a break when the persona has no picture or the station is older`() {
        assertNull(now(spoken, show = cass.copy(hostArtUrl = null)).coverPath())
        assertNull(now(spoken, show = cass.copy(hostArtUrl = "")).coverPath())
        assertNull(now(spoken, show = null).coverPath())
    }

    @Test
    fun `is nothing off air`() {
        assertNull(now(null).coverPath())
        assertNull((null as NowPlaying?).coverPath())
    }

    @Test
    fun `resolves against the station exactly as a cover does`() {
        val station = StationUrl.parse("https://radio.example.com").getOrThrow()

        assertEquals("https://radio.example.com/api/art/cass", station.artUrl(now(spoken).coverPath()))
        assertEquals("https://cdn.example/cass.jpg", station.artUrl(now(spoken, show = cass.copy(hostArtUrl = "https://cdn.example/cass.jpg")).coverPath()))
    }
}
