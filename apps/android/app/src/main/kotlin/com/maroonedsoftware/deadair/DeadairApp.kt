package com.maroonedsoftware.deadair

import android.app.Application
import android.os.SystemClock
import androidx.glance.appwidget.updateAll
import coil3.SingletonImageLoader
import com.maroonedsoftware.deadair.auth.OperatorActions
import com.maroonedsoftware.deadair.auth.SessionManager
import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.auth.SessionStore
import com.maroonedsoftware.deadair.catalog.CatalogActions
import com.maroonedsoftware.deadair.director.OrderActions
import com.maroonedsoftware.deadair.director.OrderRepository
import com.maroonedsoftware.deadair.net.HttpClients
import com.maroonedsoftware.deadair.net.imageLoaderFactory
import com.maroonedsoftware.deadair.history.HistoryRepository
import com.maroonedsoftware.deadair.nowplaying.NowPlayingRepository
import com.maroonedsoftware.deadair.playout.AirActions
import com.maroonedsoftware.deadair.playout.PlayoutRepository
import com.maroonedsoftware.deadair.playout.Transport
import com.maroonedsoftware.deadair.schedule.ScheduleRepository
import com.maroonedsoftware.deadair.scripts.ScriptActions
import com.maroonedsoftware.deadair.settings.SettingsStore
import com.maroonedsoftware.deadair.station.StationProbe
import com.maroonedsoftware.deadair.widget.StationWidget
import com.maroonedsoftware.deadair.widget.coverBitmap
import com.maroonedsoftware.deadair.widget.WidgetFeed
import com.maroonedsoftware.deadair.widget.WidgetRefreshWorker
import com.maroonedsoftware.deadair.widget.WidgetSnapshotStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.map

/**
 * The application object, and the few long-lived objects that hang off it.
 *
 * There is no dependency-injection framework here and there is not meant to be: this is a handful
 * of objects, and a code generator to wire a handful of objects is more moving parts than the thing
 * it wires. When it grows past what one class can hold, that is the moment to reconsider — not now.
 */
class DeadairApp : Application() {
    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)
        graph.widget.start()
        // Artwork goes over the same OkHttp client as everything else, so the station sees one
        // User-Agent from this phone and counts one listener rather than two.
        SingletonImageLoader.setSafe(imageLoaderFactory(this))
    }
}

/** What everything else resolves out of. */
class AppGraph(private val application: Application) {
    /**
     * Where the poll lives. Process-lifetime, because both the screen and the playback service
     * collect the same readings and neither should own the other's.
     */
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val settings: SettingsStore = SettingsStore(application)

    // A lambda rather than a method reference: `sdkFor` gained a defaulted second parameter, and a
    // reference to it is not a one-argument function type however it is called.
    val probe: StationProbe = StationProbe { station -> HttpClients.sdkFor(station) }

    val session: SessionStore = SessionStore(application)

    /**
     * The signed-in half, which most installs never use. It holds the refresh lock, so there is one
     * of it: two would be two callers able to spend the same single-use refresh token.
     */
    val sessions: SessionManager =
        SessionManager(
            store = session,
            settings = settings.settings,
            sdkFor = HttpClients::sdkFor,
            scope = scope,
        )

    /** What the station has played. Behind the session, like the schedule beside it. */
    val history: HistoryRepository =
        HistoryRepository(
            session = sessions.state,
            fetch = { query -> sessions.withSession { it.history.readHistory(query) } },
            scope = scope,
        )

    /**
     * What the station is scheduled to do, which only a signed-in listener can be told. Every read
     * goes through the session, so a signed-out install polls nothing at all.
     */
    val schedule: ScheduleRepository =
        ScheduleRepository(
            session = sessions.state,
            readCurrent = { sessions.withSession { it.schedule.readCurrentSlot() } },
            readSlots = { sessions.withSession { it.schedule.listSchedule().slots } },
            readPersonas = { sessions.withSession { it.personas.listPersonas().personas } },
            scope = scope,
        )

    /**
     * The transport reading, for a signed-in listener looking at Now playing. Polled only while
     * that tab is up, at the console's cadences, which is two requests a second per phone — fine
     * for the one or two phones a station has and the reason it is not collected anywhere else.
     */
    val playout: PlayoutRepository =
        PlayoutRepository(
            session = sessions.state,
            readStatus = { sessions.withSession { it.playout.getPlayoutStatus() } },
            readAir = { sessions.withSession { it.director.getStationAir() } },
            scope = scope,
        )

    /** Every `platform.manage` call goes through this one, so a 403 anywhere re-reads the roles and says so once. */
    val operator: OperatorActions = OperatorActions(sessions)

    val transport: Transport = Transport(operator, playout)

    /** The running order, polled while the Up next tab is up. */
    val order: OrderRepository =
        OrderRepository(
            session = sessions.state,
            read = { sessions.withSession { it.director.getTheRunningOrder() } },
            scope = scope,
        )

    val catalog: CatalogActions = CatalogActions(operator, order)

    val orderActions: OrderActions = OrderActions(operator, order)

    val air: AirActions = AirActions(operator, playout, order)

    val scripts: ScriptActions = ScriptActions(operator)

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

    /**
     * What keeps the home-screen widget's snapshot current.
     *
     * Started by [DeadairApp.onCreate] rather than constructed lazily, because its whole job is to
     * be listening when something else happens to hear from the station. It takes the poll's
     * passive tap and never `state`, so it cannot be the reason a poll is running.
     */
    val widget: WidgetFeed =
        WidgetFeed(
            store = WidgetSnapshotStore(application),
            schedule = { WidgetRefreshWorker.enqueue(application) },
            unschedule = { WidgetRefreshWorker.cancel(application) },
            settings = settings.settings,
            heard = nowPlaying.heard,
            // The cached role, off disk. A hint for what to DRAW; every press is still the API's
            // to refuse, and a 403 re-reads the roles, which takes the button away again.
            operator = sessions.state.map { it is SessionState.SignedIn && it.isOperator },
            skip = transport::skip,
            // Wall-clock, unlike the playhead's `elapsedRealtime`: this one is shown to a person as
            // a time of day and has to survive the phone being turned off and on again.
            now = System::currentTimeMillis,
            redraw = { StationWidget().updateAll(application) },
            loadCover = { url -> coverBitmap(application, url) },
            scope = scope,
        )
}
