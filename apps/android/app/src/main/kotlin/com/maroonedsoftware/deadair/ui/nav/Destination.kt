package com.maroonedsoftware.deadair.ui.nav

import androidx.navigation3.runtime.NavKey
import androidx.savedstate.serialization.SavedStateConfiguration
import kotlinx.serialization.Serializable
import kotlinx.serialization.modules.SerializersModule
import kotlinx.serialization.modules.polymorphic
import kotlinx.serialization.modules.subclass

/**
 * Where the app can be, as the back stack holds it.
 *
 * ## Why a navigation library arrived, and why this one
 *
 * For as long as the app was three tabs and a settings screen, an enum and a `when` were the
 * whole of navigation and a library would have been a dependency plus a second place for the
 * answer to live. Detail pages end that: a record page reached from a history row, an album
 * reached from the record, an artist reached from the album, and back through all three, is a
 * back stack whether or not anything calls it one, and hand-rolling one with predictive back is
 * more code than the library.
 *
 * Navigation 3 rather than its predecessor because it is the shape this codebase already prefers:
 * the stack is a plain list of values that state holds and the screen observes, keys are typed and
 * serialisable rather than route strings to be parsed, and predictive back comes from the display
 * rather than from wiring. There is nothing here that a `when` over a list could not have done —
 * which is the right relationship to have with a navigation library.
 *
 * `Home` is the tabbed part and is one entry rather than several: the tabs share a frame and
 * switching between them is not leaving the screen. Setup is deliberately NOT a destination. It is
 * derived from there being no station yet, so it is chosen above the stack rather than pushed onto
 * it — a place you cannot navigate back to.
 */
sealed interface Destination : NavKey {
    @Serializable
    data object Home : Destination

    /** Over the top of whichever tab was showing. A thing you go and do, then leave. */
    @Serializable
    data object Settings : Destination

    /** One record, reached from anywhere it is named. */
    @Serializable
    data class Track(val id: String) : Destination

    @Serializable
    data class Album(val id: String) : Destination

    @Serializable
    data class Artist(val id: String) : Destination

    /** Everything that could be put on air. Operator only; reached from the Up next tab. */
    @Serializable
    data object AirSomething : Destination

    @Serializable
    data class Playlist(val pluginId: String, val playlistId: String) : Destination

    @Serializable
    data class Chart(val id: String) : Destination
}

/**
 * How the stack survives process death.
 *
 * The stack is saved as a list of `NavKey`, which is an interface, so kotlinx.serialization has
 * to be told which classes can appear under it. Every destination is registered here; one that is
 * not would save fine and fail to restore, at the moment a listener came back to the app.
 */
val NavConfiguration: SavedStateConfiguration =
    SavedStateConfiguration {
        serializersModule =
            SerializersModule {
                polymorphic(NavKey::class) {
                    subclass(Destination.Home::class)
                    subclass(Destination.Settings::class)
                    subclass(Destination.Track::class)
                    subclass(Destination.Album::class)
                    subclass(Destination.Artist::class)
                    subclass(Destination.AirSomething::class)
                    subclass(Destination.Playlist::class)
                    subclass(Destination.Chart::class)
                }
            }
    }
