package com.maroonedsoftware.deadair.nowplaying

import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrack

/** How far through the record on air, for a progress bar. */
data class Playhead(val elapsedMs: Long, val remainingMs: Long, val durationMs: Long) {
    val fraction: Float get() = if (durationMs <= 0) 0f else elapsedMs.toFloat() / durationMs.toFloat()
}

/**
 * A length of a record as a clock reads it: `3:58`, and `1:02:10` past an hour.
 *
 * Seconds, because this is the one place in the app that counts them — the bar re-anchors every
 * few seconds and ticks between, so a label under it can honestly move once a second where a
 * schedule that re-reads its clock every half minute cannot.
 */
fun clockOf(ms: Long): String {
    val total = (ms / 1_000).coerceAtLeast(0)
    val hours = total / 3_600
    val minutes = (total % 3_600) / 60
    val seconds = total % 60
    return if (hours > 0) "%d:%02d:%02d".format(hours, minutes, seconds) else "%d:%02d".format(minutes, seconds)
}

/**
 * The playhead, projected between readings.
 *
 * The station answers with the DECODER's own countdown taken at the moment it was read, and this
 * app polls every few seconds. Showing that raw gives a clock that jumps; projecting from it gives
 * one that moves and RE-ANCHORS on every reading rather than drifting away from the station. It is
 * the same projection the console does, for the same reason.
 *
 * Returns `null` when there is nothing to measure — no track, no reported duration, or a decoder
 * that could not say how much is left. **It never extrapolates from `startedAt` alone.** A clock
 * built from a start time and the wall clock would keep moving confidently while being wrong, and
 * a transport that lies smoothly is worse than one that admits it does not know: `remainingMs`
 * already leads the listener by the encoder and client buffers, and `startedAt` is when the PLAYER
 * reported the track began, not when this listener heard it.
 */
fun project(track: NowPlayingTrack?, readAtMs: Long, nowMs: Long): Playhead? {
    val duration = track?.durationMs ?: return null
    val reported = track.remainingMs ?: return null
    if (duration <= 0) return null

    // Clamped at both ends. A reading that arrives late leaves `nowMs - readAtMs` larger than
    // what was left, and a clock that ran past the end of the record would read as a fault.
    val carried = (nowMs - readAtMs).coerceAtLeast(0)
    val remaining = (reported - carried).coerceIn(0, duration)
    return Playhead(elapsedMs = duration - remaining, remainingMs = remaining, durationMs = duration)
}
