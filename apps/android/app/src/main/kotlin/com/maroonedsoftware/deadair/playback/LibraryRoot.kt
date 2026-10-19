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
 * The title of the library root a browser is offered. Never a refusal.
 *
 * A refused root is not an error a car can show: Media3's legacy stub answers ANY error from
 * `onGetLibraryRoot` with a null root, the browser's connection fails, and Android Auto says the
 * app's content could not load. That is what Play's Auto review saw on 2026-10-19, from a fresh
 * install with no station kept, and it was enforced as an app crash. So the root is always offered
 * (under the app's own name until there is a station to name it), and "no station" is said by the
 * children instead, as an error Auto draws with a button that opens the app on the phone.
 */
fun libraryRootTitle(kept: KeptStation, appName: String): String =
    when (kept) {
        KeptStation.Unread, KeptStation.None -> appName
        is KeptStation.Named -> kept.name
    }
