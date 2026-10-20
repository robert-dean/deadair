package com.maroonedsoftware.deadair.playback

/**
 * Whether a validated cellular network is standing by while something else is the default.
 *
 * A walk on 2026-10-20 stalled for nineteen seconds on a wifi that stayed `validated=yes` until it
 * vanished; Android only then made cellular the default, and the stream came back five seconds
 * after that. A stream could move to cellular as soon as it stalls, but only if a cellular network
 * is already up beside the wifi, which depends on the phone ("Mobile data always active", on by
 * default on a Pixel). This is what says so: the journal gets a line each time [standby] changes,
 * so the next walk shows whether there was anywhere to go.
 *
 * A network standing by is a BACKGROUND one (no `NET_CAPABILITY_FOREGROUND`), and Android routes
 * no app's traffic over a background network. Using it means requesting it, which brings it to the
 * foreground; this only says that there is one to request.
 *
 * Fed by a listen-only callback, which never brings a network up. Several cellular networks can be
 * reported (each with internet, since the request asks for it); any validated one will do, and
 * the one already standing by is kept while it lasts so the line does not flicker between them.
 * Callbacks arrive on the system's connectivity thread, one at a time. Pure, so the JVM tests drive it.
 */
class CellularStandby(private val record: (String) -> Unit) {
    private val validated = mutableMapOf<Long, Boolean>()

    /** The validated cellular network standing by, by handle, or `null` for none. */
    var standby: Long? = null
        private set

    fun onCapabilities(handle: Long, isValidated: Boolean) {
        validated[handle] = isValidated
        settle()
    }

    fun onLost(handle: Long) {
        validated.remove(handle)
        settle()
    }

    private fun settle() {
        val next = standby?.takeIf { validated[it] == true } ?: validated.entries.firstOrNull { it.value }?.key
        if (next == standby) return
        standby = next
        record(if (next == null) "cellular none standing by" else "cellular standing by handle=$next")
    }
}
