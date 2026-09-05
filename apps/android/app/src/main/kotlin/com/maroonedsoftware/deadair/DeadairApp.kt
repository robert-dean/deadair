package com.maroonedsoftware.deadair

import android.app.Application
import android.os.SystemClock
import com.maroonedsoftware.deadair.net.HttpClients
import com.maroonedsoftware.deadair.nowplaying.NowPlayingRepository
import com.maroonedsoftware.deadair.settings.SettingsStore
import com.maroonedsoftware.deadair.station.StationProbe
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers

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
    /**
     * Where the poll lives. Process-lifetime, because both the screen and the playback service
     * collect the same readings and neither should own the other's.
     */
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val settings: SettingsStore = SettingsStore(application)
    val probe: StationProbe = StationProbe(HttpClients::sdkFor)

    val nowPlaying: NowPlayingRepository =
        NowPlayingRepository(
            settings = settings.settings,
            fetch = { station -> HttpClients.sdkFor(station).nowplaying.getNowPlaying() },
            // Elapsed time since boot, not the wall clock: the playhead is projected from the gap
            // between two readings, and a device whose clock is corrected between them would
            // otherwise jump or run backwards.
            elapsedMs = SystemClock::elapsedRealtime,
            scope = scope,
        )
}
