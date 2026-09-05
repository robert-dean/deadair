package com.maroonedsoftware.deadair

import android.app.Application
import com.maroonedsoftware.deadair.net.HttpClients
import com.maroonedsoftware.deadair.settings.SettingsStore
import com.maroonedsoftware.deadair.station.StationProbe

/**
 * The application object, and the few long-lived objects that hang off it.
 *
 * There is no dependency-injection framework here and there is not meant to be: this is three
 * objects, and a code generator to wire three objects is more moving parts than the thing it
 * wires. When it grows past what one class can hold, that is the moment to reconsider — not now.
 */
class DeadairApp : Application() {
    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)
    }
}

/** What everything else resolves out of. */
class AppGraph(application: Application) {
    val settings: SettingsStore = SettingsStore(application)
    val probe: StationProbe = StationProbe(HttpClients::sdkFor)
}
