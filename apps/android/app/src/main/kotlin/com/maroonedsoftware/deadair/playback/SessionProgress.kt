package com.maroonedsoftware.deadair.playback

import com.maroonedsoftware.deadair.nowplaying.Playhead
import com.maroonedsoftware.deadair.nowplaying.Reading
import com.maroonedsoftware.deadair.nowplaying.project
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrackKind
import kotlin.math.abs

/**
 * How far through the record the listener is, as the media session publishes it, or `null` for
 * nothing to publish.
 *
 * [heard] is `NowPlayingGate`'s released reading, already stamped for the listener's ears, so this
 * is the same playhead Now playing draws while the phone is playing and the lock screen's bar agrees
 * with it. The poll's own reading would run a whole buffer ahead, which is the bug the screens had.
 *
 * `null` for a break: the station talking between two records has a length the decoder knows, but
 * a bar under the host's name counting down to the next record reads as the record's progress and
 * is not. `null` too for anything `project` cannot measure (no length, no countdown), because a
 * bar that lies smoothly is worse than none, and with nothing heard at all (stopped, or a session
 * that has not released its first reading). In each of those the session falls back to the live
 * stream it is, with no position and no duration.
 */
internal fun sessionPlayhead(heard: Reading?, nowMs: Long): Playhead? {
    val track = heard?.nowPlaying?.track ?: return null
    if (track.kind == NowPlayingTrackKind.BREAK) return null
    return project(track, heard.readAtMs, nowMs)
}

/**
 * Whether moving from [before] to [after] has to be ANNOUNCED to the media session, rather than left
 * to its own extrapolation.
 *
 * The platform session is given a position, the time it was taken and a speed, and the lock screen
 * runs the bar on from there by itself; Media3 re-reads the position every few seconds while
 * playing. A reading of the same record re-anchors by a fraction of a second, which that periodic
 * read absorbs. A new record does not: the bar would run on from the end of the last one, past a
 * length that is no longer its own, until the next periodic read. So a change of length, a bar
 * appearing or going, or a jump further than [toleranceMs] is announced at once.
 */
internal fun progressJumped(before: Playhead?, after: Playhead?, toleranceMs: Long = PROGRESS_TOLERANCE_MS): Boolean {
    if (before == null || after == null) return before != after
    if (before.durationMs != after.durationMs) return true
    return abs(before.elapsedMs - after.elapsedMs) > toleranceMs
}

/** More than a poll's re-anchoring ever moves the bar, and less than a listener would notice. */
private const val PROGRESS_TOLERANCE_MS = 1_000L
