package com.maroonedsoftware.deadair.playback

import com.maroonedsoftware.deadair.sdk.models.NowPlaying
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrackKind

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
    /**
     * Ask the station now rather than waiting for the next poll.
     *
     * Called when the ICY title moves with nothing held, which is the encoder saying the record
     * changed before the poll had noticed. That is the one moment the answer is genuinely wanted,
     * and asking for it here is what lets the poll itself be slow: one request per record, on the
     * record's own schedule, instead of twenty a minute in the hope of catching the change.
     */
    private val refresh: () -> Unit = {},
) {
    private var pending: Cancel? = null

    /** The reading held back because its track moved and the audio has not caught up yet. */
    private var held: NowPlaying? = null

    private var seenFirst = false
    private var lastIcyTitle: String? = null

    /** An ICY change has asked the station for a fresh reading, and the next one is that answer. */
    private var awaitingRefresh = false

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
     *
     * `ageMs` is how long ago that reading was actually TAKEN. It was assumed to be nothing for as
     * long as the poll ran every three seconds no matter what, and then it stopped being nothing:
     * a poll that slows down while nobody can see it (`NowPlayingRepository`'s unwatched cadence)
     * hands this a reading that already describes the past. The hold is the part of the buffer
     * that has not played yet, so the arithmetic is the buffer MINUS that age; holding the whole
     * of it again would publish the record about as long after the listener heard it start as the
     * poll is slow.
     */
    fun onPoll(reading: NowPlaying?, bufferedMs: Long, ageMs: Long = 0) {
        val startedAt = reading?.track?.startedAt
        val trackMoved = seenFirst && startedAt != pushedFor
        // This is the answer an ICY change asked for, so the audio is already known to have
        // reached whatever it says: there is nothing left to hold it for.
        val confirming = awaitingRefresh
        awaitingRefresh = false
        seenFirst = true

        if (!trackMoved || confirming) {
            cancelPending()
            held = null
            // `pushedFor` moves even when nothing is pushed, so a record whose fields happen to
            // match the one before it (the same track aired twice) is not read as a fresh change
            // by every poll after this one. Unchanged in the ordinary `!trackMoved` case, where it
            // is already this value.
            pushedFor = startedAt
            // A field the lock screen does not show (listeners, remainingMs, ...) moving on its own
            // is not a reason to push: only what `Shown` captures is.
            if (reading.shown() != lastPushedShown) pushNow(reading)
            return
        }

        // A buffer longer than the poll interval (routine on HLS, which carries no ICY of its own)
        // means this same moved track is seen again before its release fires. Cancelling and rescheduling on every one of those polls would push the release out
        // by another `bufferedMs` each time and it would never actually happen. So a poll that is
        // still describing the track already held just refreshes the fields that will eventually be
        // pushed, without touching the timer already counting down to that release.
        if (pending != null && startedAt == held?.track?.startedAt) {
            held = reading
            return
        }

        held = reading
        cancelPending()
        pending = schedule((bufferedMs - ageMs).coerceAtLeast(0)) { releaseHeld() }
    }

    /**
     * The in-band title changed: the encoder has moved to the next record, on the audio's own
     * schedule, which is the listener's.
     *
     * Whatever was held is released early — the poll had already seen this record and was only
     * waiting for the ears to catch up. With nothing held the poll has NOT seen it yet, so the
     * reading in hand describes the record that just ended and publishing it would put the wrong
     * title on the lock screen; the station is asked instead, and `onPoll` publishes the answer
     * the moment it lands. Republishing `latest` was what this did while the poll ran every three
     * seconds, when `latest` was at worst three seconds stale and usually already the new record.
     */
    fun onIcyTitle(title: String?) {
        if (title == lastIcyTitle) return
        lastIcyTitle = title
        if (!seenFirst) return

        cancelPending()
        val toRelease = held
        held = null
        if (toRelease != null) {
            pushNow(toRelease)
            return
        }
        awaitingRefresh = true
        refresh()
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
        awaitingRefresh = false
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

    /**
     * The fields of a reading that reach the lock screen, the notification and a head unit.
     *
     * The kind and the show among them, because `lockScreenText` draws a break from the host and the
     * show's name: a recast during a break changes what the lock screen says with nothing about the
     * item moving.
     */
    private data class Shown(
        val onAir: Boolean,
        val station: String?,
        val kind: NowPlayingTrackKind?,
        val title: String?,
        val artist: String?,
        val album: String?,
        val artworkUrl: String?,
        val show: String?,
        val host: String?,
    )

    private fun NowPlaying?.shown() =
        Shown(
            onAir = this != null,
            station = this?.station,
            kind = this?.track?.kind,
            title = this?.track?.title,
            artist = this?.track?.artist,
            album = this?.track?.album,
            artworkUrl = this?.track?.artworkUrl,
            show = this?.show?.name,
            host = this?.show?.host,
        )
}
