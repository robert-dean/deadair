package com.maroonedsoftware.deadair.nowplaying

import com.maroonedsoftware.deadair.sdk.models.LyricLineDetail
import com.maroonedsoftware.deadair.sdk.models.NowPlayingLyrics
import com.maroonedsoftware.deadair.sdk.models.TrackLyrics
import com.maroonedsoftware.deadair.sdk.models.TrackLyricsKind
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

@OptIn(ExperimentalUuidApi::class)
class LyricsTest {
    private val track = Uuid.parse("33333333-3333-4333-8333-333333333333")
    private val started = 1_790_000_000_000L
    private val lines =
        listOf(
            LyricLineDetail(atMs = 10_000, text = "First line"),
            LyricLineDetail(atMs = 14_000, text = "Second line"),
            LyricLineDetail(atMs = 18_000, text = ""),
            LyricLineDetail(atMs = 25_000, text = "After the gap"),
        )

    private fun answer(kind: TrackLyricsKind = TrackLyricsKind.WORDS, synced: List<LyricLineDetail>? = lines, plain: String? = null, cueOutMs: Long? = null, startedAt: Long = started) =
        NowPlayingLyrics(
            onAir = true,
            trackId = track,
            startedAt = startedAt,
            cueOutMs = cueOutMs,
            lyrics = TrackLyrics(trackId = track, kind = kind, provider = "deadair.lrclib", synced = synced, plain = plain),
        )

    /** A playhead `elapsed` into a record of `duration`, as `project` builds one. */
    private fun at(elapsed: Long, duration: Long = 240_000) = Playhead(elapsedMs = elapsed, remainingMs = duration - elapsed, durationMs = duration)

    @Test
    fun `an unmeasured record's position is its length minus what remains`() {
        assertEquals(15_000L, lyricPositionMs(at(15_000), cueOutMs = null))
    }

    @Test
    fun `a measured record's position counts back from the cue-out, not from the file's length`() {
        // Three seconds of tail trimmed: 200s left of a 240s file is 37s in, not 40s.
        val playhead = Playhead(elapsedMs = 40_000, remainingMs = 200_000, durationMs = 240_000)
        assertEquals(37_000L, lyricPositionMs(playhead, cueOutMs = 237_000))
    }

    @Test
    fun `the current line is the last one that has started`() {
        assertNull(currentLine(lines, 9_999))
        assertEquals(0, currentLine(lines, 10_000))
        assertEquals(1, currentLine(lines, 17_999))
        assertEquals(3, currentLine(lines, 300_000))
    }

    @Test
    fun `a blank line is a gap, and lights nothing`() {
        assertNull(currentLine(lines, 20_000))
    }

    @Test
    fun `timed lines are lit from the heard playhead`() {
        val state = lyricsUiState(answer(), started, at(15_000)) as LyricsUiState.Synced
        assertEquals(1, state.current)
        assertEquals("deadair.lrclib", state.provider)
    }

    @Test
    fun `a decoder that cannot say where it is shows the lines unlit`() {
        val state = lyricsUiState(answer(), started, playhead = null) as LyricsUiState.Synced
        assertNull(state.current)
    }

    @Test
    fun `lyrics for another airing are not shown at all`() {
        // The station names the next record while this listener still hears the last one.
        assertEquals(LyricsUiState.Hidden, lyricsUiState(answer(startedAt = started + 240_000), started, at(230_000)))
        assertEquals(LyricsUiState.Hidden, lyricsUiState(answer(), heardStartedAt = null, playhead = null))
    }

    @Test
    fun `plain words show when there are no timings`() {
        assertEquals(LyricsUiState.Plain("Words only", "deadair.lrclib"), lyricsUiState(answer(synced = null, plain = "Words only"), started, at(1_000)))
    }

    @Test
    fun `nothing to show draws no button`() {
        assertEquals(LyricsUiState.Hidden, lyricsUiState(null, started, at(1_000)))
        assertEquals(LyricsUiState.Hidden, lyricsUiState(answer(kind = TrackLyricsKind.NONE, synced = null), started, at(1_000)))
        assertEquals(LyricsUiState.Hidden, lyricsUiState(answer(kind = TrackLyricsKind.INSTRUMENTAL, synced = null), started, at(1_000)))
        assertEquals(LyricsUiState.Hidden, lyricsUiState(answer(synced = emptyList(), plain = " "), started, at(1_000)))
    }
}
