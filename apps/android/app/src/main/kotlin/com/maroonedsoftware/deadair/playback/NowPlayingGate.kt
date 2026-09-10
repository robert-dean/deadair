package com.maroonedsoftware.deadair.playback

import com.maroonedsoftware.deadair.sdk.models.NowPlaying

/**
 * Decides when the poll's reading actually reaches the lock screen.
 *
 * The poll and the audio disagree about when a record changed: the poll learns it the moment the
 * station's own director commits the next item, and the audio carries it however many seconds are
 * sitting in the player's buffer at that instant. Pushing on the poll alone changes the notification
 * before the listener hears anything different, which reads as wrong even though the data was
 * right. So the in-band ICY title (which changes when the ENCODER moves to the new record, and
 * therefore arrives at the client on the same schedule as the audio itself) is the trigger, and
 * the poll stays the source of the fields it pushes.
 *
 * Pure Kotlin, like `ReconnectPolicy` beside it: `schedule` is injected rather than a `Handler`, so
 * this is tested on the JVM with no `android.*` import. A sibling class rather than more
 * responsibilities folded into `ReconnectPolicy`, because the two decisions (whether to retry the
 * stream, and when to publish what it is playing) share nothing but the player they sit next to.
 */
class NowPlayingGate(
    private val schedule: (Long, () -> Unit) -> Cancel,
    private val push: (NowPlaying?) -> Unit,
) {
    private var pending: Cancel? = null

    /** The reading held back because its track moved and the audio has not caught up yet. */
    private var held: NowPlaying? = null

    /** The most recent reading seen, held or not: what an ICY change with nothing held falls back to. */
    private var latest: NowPlaying? = null
    private var seenFirst = false
    private var lastIcyTitle: String? = null

    /** What was pushed for last, so an unmoved `startedAt` can still be told from a moved one. */
    private var pushedFor: Long? = null

    /**
     * The fields of the last pushed reading that the lock screen actually shows, so an unmoved poll
     * that changed nothing visible is a no-op rather than a fresh `replaceMediaItem` every three
     * seconds: churn the old `pushedFor` guard was meant to prevent and did not, because it only
     * ever compared the track's `startedAt`.
     */
    private var lastPushedShown: Shown? = null

    /**
     * A fresh poll reading. `bufferedMs` is the player's own `totalBufferedDuration` at the moment
     * of the poll: however much audio is already sitting in the buffer is exactly how far behind
     * the poll the listener's ears are, so it is also how long the held reading may wait before
     * being pushed anyway, ICY title or not.
     */
    fun onPoll(reading: NowPlaying?, bufferedMs: Long) {
        latest = reading
        val startedAt = reading?.track?.startedAt
        val trackMoved = seenFirst && startedAt != pushedFor
        seenFirst = true

        if (!trackMoved) {
            cancelPending()
            held = null
            // A field the lock screen does not show (listeners, remainingMs, ...) moving on its own
            // is not a reason to push: only what `Shown` captures is.
            if (reading.shown() != lastPushedShown) pushNow(reading)
            return
        }

        // The poll runs every three seconds, and a buffer longer than that (routine on HLS, which
        // carries no ICY of its own) means this same moved track is seen again before its release
        // fires. Cancelling and rescheduling on every one of those polls would push the release out
        // by another `bufferedMs` each time and it would never actually happen. So a poll that is
        // still describing the track already held just refreshes the fields that will eventually be
        // pushed, without touching the timer already counting down to that release.
        if (pending != null && startedAt == held?.track?.startedAt) {
            held = reading
            return
        }

        held = reading
        cancelPending()
        pending = schedule(bufferedMs) { releaseHeld() }
    }

    /**
     * The in-band title changed. Whatever was held is released early, and an ICY change with
     * nothing held still republishes the latest reading, because the change just proved the audio
     * caught up to it.
     */
    fun onIcyTitle(title: String?) {
        if (title == lastIcyTitle) return
        lastIcyTitle = title
        if (!seenFirst) return

        cancelPending()
        val toPush = held ?: latest
        held = null
        pushNow(toPush)
    }

    /**
     * Drop a pending release, if there is one, and whatever it would have pushed.
     *
     * Also forgets what was last pushed. `PlaybackConductor` calls this right before it sets a
     * fresh media item with blank metadata (a format change, a station change), so the next poll
     * must push even if nothing about the reading itself moved: otherwise the new item is left
     * showing nothing until the track actually changes.
     */
    fun cancel() {
        cancelPending()
        held = null
        lastPushedShown = null
    }

    private fun releaseHeld() {
        pending = null
        val reading = held ?: return
        held = null
        pushNow(reading)
    }

    private fun pushNow(reading: NowPlaying?) {
        pushedFor = reading?.track?.startedAt
        lastPushedShown = reading.shown()
        push(reading)
    }

    private fun cancelPending() {
        pending?.invoke()
        pending = null
    }

    /** The fields of a reading that reach the lock screen, the notification and a head unit. */
    private data class Shown(
        val onAir: Boolean,
        val station: String?,
        val title: String?,
        val artist: String?,
        val album: String?,
        val artworkUrl: String?,
    )

    private fun NowPlaying?.shown() =
        Shown(
            onAir = this != null,
            station = this?.station,
            title = this?.track?.title,
            artist = this?.track?.artist,
            album = this?.track?.album,
            artworkUrl = this?.track?.artworkUrl,
        )
}
