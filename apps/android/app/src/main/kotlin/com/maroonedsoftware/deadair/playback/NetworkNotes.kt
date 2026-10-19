package com.maroonedsoftware.deadair.playback

/**
 * The phone's default network as the playback journal sees it: one line each time it becomes a
 * different network, or the same one changes kind or validation, and one when it goes.
 *
 * `ReconnectPolicy` hears the default network by handle alone, which is all it needs to decide.
 * Reading a drop afterwards needs more: whether the move was wifi to cellular, and whether the wifi
 * it moved to was one Android had validated, because a phone walking out of range flips between a
 * failing wifi and cellular and each flip is a restart. Capabilities are reported far more often
 * than they change (signal strength rides along with them), so only a change of what is written
 * here is written. Pure, so the JVM tests drive it; `PlaybackService` maps `NetworkCapabilities` to
 * the [transport] word.
 *
 * Callbacks arrive on the system's connectivity thread, one at a time, which is the only thread
 * that touches this.
 */
class NetworkNotes(private val record: (String) -> Unit) {
    private var current: Long? = null
    private var last: String? = null

    /** The default network is [handle], of [transport] (`wifi`, `cellular`, ...), validated or not. */
    fun onDefault(handle: Long, transport: String, validated: Boolean) {
        val line = "network $transport handle=$handle validated=${if (validated) "yes" else "no"}"
        current = handle
        if (line == last) return
        last = line
        record(line)
    }

    /**
     * [handle] has gone. Written only when it was the default: a handover can report the old
     * network lost after the new one is already the default, and that is not the phone going
     * offline.
     */
    fun onLost(handle: Long) {
        if (handle != current) return
        current = null
        last = null
        record("network none (handle=$handle lost)")
    }
}
