package com.maroonedsoftware.deadair.nowplaying

import com.maroonedsoftware.deadair.sdk.models.LyricLineDetail
import com.maroonedsoftware.deadair.sdk.models.NowPlayingLyrics
import com.maroonedsoftware.deadair.sdk.models.TrackLyricsKind

/**
 * Where in the FILE the listener is, which is the timeline every lyric line's `atMs` is on.
 *
 * The one place this is worked out. The decoder's `remainingMs` counts down to the record's cue-out,
 * the point the player was told to stop reading, so the position is that point minus what remains.
 * A record nothing has measured plays to the end of the file, whose length is the reading's
 * `durationMs`, which is what the playhead already carries. Never `startedAt` and the wall clock,
 * for the reason [project] gives; and never `durationMs - remainingMs` for a measured record,
 * which runs ahead by however much tail the measurement trimmed.
 */
fun lyricPositionMs(playhead: Playhead, cueOutMs: Long?): Long = ((cueOutMs ?: playhead.durationMs) - playhead.remainingMs).coerceAtLeast(0)

/**
 * The line being sung at [positionMs]: the last one that has started. `null` before the first line,
 * and on a blank line, which is the gap a source marks between verses and is not a line to light.
 */
fun currentLine(lines: List<LyricLineDetail>, positionMs: Long): Int? {
    var current: Int? = null
    for ((index, line) in lines.withIndex()) {
        if (line.atMs > positionMs) break
        current = index
    }
    return current?.takeIf { lines[it].text.isNotBlank() }
}

/** What the lyrics sheet, and the button that opens it, have to show. */
sealed interface LyricsUiState {
    /** Nothing to offer: signed out, off air, a break, an instrumental, a record no source has words for, or lyrics for another airing. The button is not drawn. */
    data object Hidden : LyricsUiState

    /** Words with no timings, shown as they came. */
    data class Plain(val text: String, val provider: String?) : LyricsUiState

    /**
     * Timed lines. [current] is the line being heard, or `null` when none is: before the singing, in a
     * gap, or while the decoder cannot say where the record is.
     */
    data class Synced(val lines: List<LyricLineDetail>, val current: Int?, val provider: String?) : LyricsUiState
}

/**
 * The sheet's state from the lyrics answer and what the listener is hearing.
 *
 * [heardStartedAt] is the `startedAt` of the reading the screen draws, which on a phone that is
 * playing is the gate's delayed copy. The lyrics are shown only when they are for that same airing:
 * both instants are the station's own record of when the record went on, so a difference means a
 * different record, and across a changeover the station already names the next one while the
 * listener still hears the last. Showing those words, lit or not, would be the wrong song's.
 */
fun lyricsUiState(answer: NowPlayingLyrics?, heardStartedAt: Long?, playhead: Playhead?): LyricsUiState {
    val lyrics = answer?.lyrics ?: return LyricsUiState.Hidden
    if (heardStartedAt == null || answer.startedAt != heardStartedAt) return LyricsUiState.Hidden
    return when (lyrics.kind) {
        TrackLyricsKind.NONE, TrackLyricsKind.INSTRUMENTAL -> LyricsUiState.Hidden
        TrackLyricsKind.WORDS -> {
            val lines = lyrics.synced
            val plain = lyrics.plain
            when {
                !lines.isNullOrEmpty() -> {
                    val current = playhead?.let { currentLine(lines, lyricPositionMs(it, answer.cueOutMs)) }
                    LyricsUiState.Synced(lines, current, lyrics.provider)
                }
                !plain.isNullOrBlank() -> LyricsUiState.Plain(plain, lyrics.provider)
                else -> LyricsUiState.Hidden
            }
        }
    }
}
