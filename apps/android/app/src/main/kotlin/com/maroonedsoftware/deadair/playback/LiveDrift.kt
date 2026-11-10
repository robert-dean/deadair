package com.maroonedsoftware.deadair.playback

/**
 * How far behind the station this connection has fallen since it started, and when to jump back.
 *
 * A live stream never catches up on its own here. HLS has its playback speed pinned to 1.0
 * (`MediaItems.forMount`, because ExoPlayer's time-stretch is audible on music), and an Icecast
 * mount has no live edge to catch up to at all, so every second the player wanted to play and did
 * not (a stall, a rebuffer, a phone call suppressing the audio) is a second further behind for as
 * long as the connection lasts. On HLS that ran to the whole 30-second playlist before the
 * behind-live jump pulled it back; on a mount it had no limit.
 *
 * So the lost time is counted, from the first moment this connection played, and a record
 * starting in the listener's ears is the moment to give it back: the jump costs the opening
 * seconds of a record, which is the cut a listener notices least, and never a break, whose words
 * are the point of it.
 *
 * The live offset would be the direct measure on HLS and is not used: `LivePlayer` answers no
 * offset while it draws a record's progress bar, which is exactly when this is asked, and a mount
 * has none to answer.
 *
 * Pure, with times passed in, so the JVM tests drive it.
 */
class LiveDrift(private val slackMs: Long = SLACK_MS) {
    /** This connection has played at least once, so a silence from here on is time lost. */
    private var started = false

    /** Time lost in silences that have ended. */
    private var lostMs = 0L

    /** When the current silence began, if the player wanted to play and is not. */
    private var silentSince: Long? = null

    /** The player started or stopped producing audio; [wantsPlay] is `playWhenReady` at that moment. */
    fun onPlaying(isPlaying: Boolean, wantsPlay: Boolean, atMs: Long) {
        if (isPlaying) {
            silentSince?.let { lostMs += atMs - it }
            silentSince = null
            started = true
        } else if (started && wantsPlay && silentSince == null) {
            silentSince = atMs
        }
    }

    /** How far behind where this connection started the listener is now. */
    fun behindMs(atMs: Long): Long = lostMs + (silentSince?.let { atMs - it } ?: 0)

    /**
     * A record started in the listener's ears. The time lost when the player should jump to the
     * live edge now, having forgotten it; `null` when it should play on. [isRecord] is false for
     * a break, which is never cut into.
     */
    fun onRecordHeard(isRecord: Boolean, atMs: Long): Long? {
        if (!isRecord) return null
        val behind = behindMs(atMs)
        if (behind < slackMs) return null
        reset()
        return behind
    }

    /** A fresh connection, or a jump to the live edge: whatever was lost is no longer behind. */
    fun reset() {
        started = false
        lostMs = 0
        silentSince = null
    }

    companion object {
        /**
         * How far behind before a record change is spent catching up. Ordinary stalls on a good
         * network were 274 and 605ms; eight seconds is a listener who would notice, and a jump
         * that costs no more of a record's opening than it gives back.
         */
        const val SLACK_MS = 8_000L
    }
}
