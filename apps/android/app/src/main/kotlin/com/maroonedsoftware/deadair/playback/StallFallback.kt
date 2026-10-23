package com.maroonedsoftware.deadair.playback

/**
 * Moves a stream that has stalled on wifi to the cellular network standing by, instead of waiting
 * for Android to give up on the wifi.
 *
 * Measured on a walk on 2026-10-20: the audio stalled at 10:35:47, the wifi stayed `validated=yes`
 * until it vanished at 10:36:06, and only then did Android make cellular the default and the
 * stream move. Twenty-four seconds of silence, nineteen of them on a wifi that was passing nothing,
 * with a validated cellular network up beside it the whole time. Android's own judgement of the
 * wifi gave no warning, so the trigger is the stall itself: [thresholdMs] of buffering while the
 * default is wifi and a cellular network is standing by (`CellularStandby`). Ordinary stalls on a
 * good network were 274ms and 605ms that morning, so four seconds is well clear of them.
 *
 * Moving means [request]ing cellular, because the network standing by is a BACKGROUND one and
 * Android carries no app's traffic over that. The service binds the process to whatever the
 * request answers and reports it through [onPinned]; the reconnect policy then sees the stream's
 * network change and restarts it there, through the same path a handover takes.
 *
 * The pin lets go ([release]) when:
 * - the default network becomes a DIFFERENT network: Android has moved on, and the stream follows
 *   the default again. If that is the cellular network already pinned (the wifi finally dropped),
 *   the stream's network does not change and nothing restarts; if it is a wifi, it is an ordinary
 *   move. The default going to NONE does not release it: that is the wifi going, and the stream is
 *   on cellular precisely so that it can carry on.
 * - playback stops, so the next session starts on the default.
 * - the cellular network itself goes, or the request is never answered.
 *
 * A stall that turns out to be the station rather than the wifi moves to cellular too, and stays
 * there until one of those. That is the price of not waiting, and it is paid in mobile data only
 * while the station is already failing to play.
 *
 * **Two failures move it too, because a dying wifi does not always stall.** On 2026-10-21 the
 * stream fell behind the live window at 17:28:07, was reported stuck playing at 17:28:54, and the
 * wifi was lost at 17:29:04, all without the player ever buffering, so the stall rule never ran. A
 * [Failure.Stuck] stream has already made no progress for ten seconds when it is reported, so it
 * moves at once. [Failure.BehindLive] is first answered by the reconnect policy jumping to the
 * live edge, which is cheap and is usually all a stall on good wifi needs; falling behind AGAIN
 * within [BEHIND_LIVE_REPEAT_MS] means the edge did not hold, and that one moves.
 *
 * Main thread only: the service hands it the network changes it hears on the connectivity thread.
 * Pure, with time injected as [schedule], so the JVM tests drive it as they do `ReconnectPolicy`.
 */
class StallFallback(
    private val schedule: (Long, () -> Unit) -> Cancel,
    private val request: () -> Unit,
    private val release: () -> Unit,
    /** Told each decision, for the playback journal. */
    private val note: (String) -> Unit = {},
    private val thresholdMs: Long = THRESHOLD_MS,
) {
    /** The last default network that was not none, so the same wifi coming back is not a change. */
    private var defaultHandle: Long? = null
    private var defaultIsWifi = false
    private var standby: Long? = null
    private var stalled = false
    private var timer: Cancel? = null

    /** Cellular has been requested, or is pinned: either way, there is something to release. */
    private var engaged = false

    /** The stream fell behind the live window within [BEHIND_LIVE_REPEAT_MS]. */
    private var behindRecently = false

    /** A failure of the player that says the network may be dying without it ever buffering. */
    enum class Failure {
        /** Playing, with no progress, for long enough that the player gave up on it. */
        Stuck,

        /** The playlist slid past the position the player was holding. */
        BehindLive,
    }

    /** The default network is [handle] of [kind] (`wifi`, `cellular`, ...), or `null` for none. */
    fun onDefault(handle: Long?, kind: String?) {
        if (handle == null) {
            defaultIsWifi = false
            cancelTimer()
            return
        }
        val changed = defaultHandle != null && handle != defaultHandle
        defaultHandle = handle
        defaultIsWifi = kind == "wifi"
        if (!defaultIsWifi) cancelTimer()
        if (engaged && changed) disengage("default is now $kind handle=$handle")
    }

    /** The validated cellular network standing by, by handle, or `null` for none. */
    fun onStandby(handle: Long?) {
        standby = handle
    }

    /** Playback that was running has started buffering. */
    fun onStall() {
        if (stalled) return
        stalled = true
        if (!engaged && defaultIsWifi) timer = schedule(thresholdMs) {
            timer = null
            fire()
        }
    }

    /** Playback is running again, or has ended for some other reason than a stall. */
    fun onResumed() {
        stalled = false
        cancelTimer()
    }

    /** The player failed in a way that can be the wifi dying without a stall. */
    fun onFailure(failure: Failure) {
        if (engaged || !defaultIsWifi) return
        when (failure) {
            Failure.Stuck -> move("stuck playing")
            Failure.BehindLive ->
                if (behindRecently) {
                    move("fell behind the live window twice")
                } else {
                    behindRecently = true
                    schedule(BEHIND_LIVE_REPEAT_MS) { behindRecently = false }
                }
        }
    }

    /** The request was answered and the process is bound to [handle]. */
    fun onPinned(handle: Long) {
        if (engaged) note("fallback: on cellular handle=$handle")
    }

    /** The pinned cellular network has gone. */
    fun onCellularLost() {
        if (engaged) disengage("cellular lost")
    }

    /** The request timed out without a network. */
    fun onUnanswered() {
        if (engaged) disengage("cellular request unanswered")
    }

    /** The listener has stopped, or something stopped for them. */
    fun onStopped() {
        stalled = false
        cancelTimer()
        if (engaged) disengage("stopped")
    }

    private fun fire() {
        if (!stalled || engaged || !defaultIsWifi) return
        move("stalled ${thresholdMs}ms")
    }

    /** Ask for the cellular network standing by, because of [why]; or say there is none. */
    private fun move(why: String) {
        cancelTimer()
        val cellular = standby
        if (cellular == null) {
            note("fallback: $why on wifi, no cellular standing by")
            return
        }
        engaged = true
        note("fallback: $why on wifi, requesting cellular handle=$cellular")
        request()
    }

    private fun disengage(why: String) {
        engaged = false
        note("fallback released: $why")
        release()
    }

    private fun cancelTimer() {
        timer?.invoke()
        timer = null
    }

    companion object {
        const val THRESHOLD_MS = 4_000L

        /** The reconnect policy's own window for a second fall behind the live window; the two agree. */
        const val BEHIND_LIVE_REPEAT_MS = 30_000L
    }
}
