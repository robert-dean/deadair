package com.maroonedsoftware.deadair.playback

/**
 * Where the phone's sound is going, as the decision below needs it: what kind of output, and what the
 * system calls it. Read off the media router's selected route at the Compose edge; nothing here knows
 * `android.*`, so the decision is a plain JVM test.
 */
data class OutputRoute(val kind: Kind, val name: String) {
    enum class Kind {
        /** The phone's own loudspeaker (or earpiece). */
        PHONE,

        /** Something plugged in: wired headphones, a USB or dock output. The listener can see the lead. */
        WIRED,

        /** A Bluetooth device: earbuds, a speaker, a car. */
        BLUETOOTH,

        /** Anything on the network the system switcher moved the sound to: a speaker, a TV, a receiver. */
        REMOTE,

        /** A route the router could not place, left unnamed rather than guessed at. */
        OTHER,
    }
}

/**
 * The name for "Playing on" under the controls, or `null` while nothing is playing or the sound is
 * coming out of the phone or something plugged into it.
 *
 * Only Bluetooth and network outputs are named: those are the ones a listener can choose without
 * touching the phone, and so the ones worth saying where the sound went. iOS names AirPlay and
 * Bluetooth for the same reason (`playingOn` in `DeadairCore`). A nameless route is not worth a line.
 */
fun playingOn(route: OutputRoute?, playing: Boolean): String? {
    if (!playing || route == null || route.name.isBlank()) return null
    return when (route.kind) {
        OutputRoute.Kind.BLUETOOTH, OutputRoute.Kind.REMOTE -> route.name
        OutputRoute.Kind.PHONE, OutputRoute.Kind.WIRED, OutputRoute.Kind.OTHER -> null
    }
}
