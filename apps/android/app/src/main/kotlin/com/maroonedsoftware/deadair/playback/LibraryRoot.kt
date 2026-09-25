package com.maroonedsoftware.deadair.playback

import com.maroonedsoftware.deadair.settings.ListenerSettings

/**
 * What the playback service knows about the kept station, held ahead of any browser asking.
 *
 * Held rather than read on demand because of one caller: a LEGACY browser (the system's media
 * controls, Android Auto, a Bluetooth head unit) asking for the library root. Media3 answers that
 * on the main thread and BLOCKS it until the root's future completes, so a future completed by a
 * coroutine that has to come back to the main thread (a DataStore read does) never completes, and
 * the app stops answering input until Android calls it an ANR. Measured on the emulator on
 * 2026-09-25 with the Plan screen open. The root is therefore answered from this, at once.
 */
sealed interface KeptStation {
    /** The settings have not been read yet: the service is seconds old. */
    data object Unread : KeptStation

    /** No station has ever been chosen, so there is nothing to offer. */
    data object None : KeptStation

    data class Named(val name: String) : KeptStation

    companion object {
        /** What the station calls itself, as last kept, falling back to its address. */
        fun of(settings: ListenerSettings): KeptStation {
            val station = settings.station ?: return None
            return Named(settings.stationName ?: station.origin)
        }
    }
}

/**
 * The title of the library root a browser is offered, or `null` to refuse it.
 *
 * Refused only when the settings are KNOWN to hold no station. A browser that connects before they
 * have been read (a car starting the service cold, which is the ordinary case) is offered the root
 * under the app's own name rather than refused, because it cannot be told to wait and a refusal is
 * not asked again: the children, which Media3 answers asynchronously, read the settings themselves
 * and say whether the folder is empty.
 */
fun libraryRootTitle(kept: KeptStation, appName: String): String? =
    when (kept) {
        KeptStation.Unread -> appName
        KeptStation.None -> null
        is KeptStation.Named -> kept.name
    }
