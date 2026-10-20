package com.maroonedsoftware.deadair.playback

/**
 * Which play, stop and item lines the playback journal gets, and which it already has.
 *
 * Read back from a walk on 2026-10-20, the first journal said two misleading things. `play`
 * named `live.mp3` while what played was `live.m3u8`, because the line took the item the player
 * held at the moment of the press, before the format had been chosen. And unplugging headphones
 * wrote two stops, `headphones-unplugged` and then `listener`, because the policy answers that
 * pause with a stop of its own. So `play` names nothing, the item is written when it changes, and
 * only the first stop of a session is written: that is the one that says why.
 *
 * Pure, so the JVM tests drive it; `PlaybackLog` feeds it the player's events.
 */
class SessionLines {
    private var stopped = true
    private var item: String? = null

    /** The line for `playWhenReady` turning [playing], stopped for [reason], or `null` when there is nothing new to say. */
    fun onPlayWhenReady(playing: Boolean, reason: String): String? {
        if (playing == !stopped) return null
        stopped = !playing
        return if (playing) "play" else "stop reason=$reason"
    }

    /**
     * The line for the player now holding [uri], or `null` when it is the item already written. A
     * restart sets the same item again, and that is said by the policy's own line.
     */
    fun onItem(uri: String?): String? {
        if (uri == null || uri == item) return null
        item = uri
        return "item uri=$uri"
    }
}
