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

/**
 * The word being sung on [line] at [positionMs]: the index of the last timed piece of it that has
 * started. `null` on a line its source did not time word by word, which is shown as a line exactly as
 * before, and before the line's first piece.
 */
fun currentWord(line: LyricLineDetail, positionMs: Long): Int? {
    val words = line.words ?: return null
    var current: Int? = null
    for ((index, word) in words.withIndex()) {
        if (word.atMs > positionMs) break
        current = index
    }
    return current
}

/**
 * How many characters of [line]'s text have been sung once piece [word] has started: the pieces up
 * to and including it, joined. The station guarantees the pieces join to the text, so this is a
 * prefix of it; clamped anyway, so a line that broke that promise lights too little rather than
 * throwing.
 */
fun sungLength(line: LyricLineDetail, word: Int): Int = line.words.orEmpty().take(word + 1).sumOf { it.text.length }.coerceAtMost(line.text.length)

/** What the lyrics sheet, and the button that opens it, have to show. */
sealed interface LyricsUiState {
    /** Nothing to offer: signed out, off air, a break, an instrumental, a record no source has words for, or lyrics for another airing. The button is not drawn. */
    data object Hidden : LyricsUiState

    /** Words with no timings, shown as they came. */
    data class Plain(val text: String, val provider: String?) : LyricsUiState

    /**
     * Timed lines. [current] is the line being heard, or `null` when none is: before the singing, in a
     * gap, or while the decoder cannot say where the record is. [sung] is how many characters of that
     * line have been sung, when its source timed the words, and `null` when it did not or none has
     * started yet, which lights the line whole as before.
     */
    data class Synced(val lines: List<LyricLineDetail>, val current: Int?, val provider: String?, val sung: Int? = null) : LyricsUiState
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
        // `UNKNOWN` is a kind a newer station sends that this build cannot read, so there are no words to show.
        TrackLyricsKind.NONE, TrackLyricsKind.INSTRUMENTAL, TrackLyricsKind.UNKNOWN -> LyricsUiState.Hidden
        TrackLyricsKind.WORDS -> {
            val lines = lyrics.synced
            val plain = lyrics.plain
            when {
                !lines.isNullOrEmpty() -> {
                    val position = playhead?.let { lyricPositionMs(it, answer.cueOutMs) }
                    val current = position?.let { currentLine(lines, it) }
                    val sung = if (current != null && position != null) currentWord(lines[current], position)?.let { sungLength(lines[current], it) } else null
                    LyricsUiState.Synced(lines, current, lyrics.provider, sung)
                }
                !plain.isNullOrBlank() -> LyricsUiState.Plain(plain, lyrics.provider)
                else -> LyricsUiState.Hidden
            }
        }
    }
}
