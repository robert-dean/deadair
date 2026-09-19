package com.maroonedsoftware.deadair.playback

import android.content.Context
import android.graphics.drawable.Icon
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import com.maroonedsoftware.deadair.DeadairApp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.settings.SettingsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The station as a Quick Settings tile: one press on, one press off, without opening the app.
 *
 * It drives the session through a `PlayerConnection`, exactly as the app's screen does, so a press
 * here is the same `play()` the Play button sends and reaches the same `LivePlayer`. The tile's own
 * connection lives only while the shade is open: binding the playback service for longer would keep
 * it alive for a tile nobody is looking at.
 *
 * With no station kept the tile is UNAVAILABLE, which the system draws greyed and delivers no press
 * to. The app is where a station is chosen, and a long press on any tile already opens it.
 *
 * A tile cannot ask for the notification permission; it leans on the media session's exemption,
 * which the in-app prompt (`NotificationsAsked`) exists so as not to lean on alone.
 */
class StationTileService : TileService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var connection: PlayerConnection? = null
    private var drawing: Job? = null

    override fun onStartListening() {
        super.onStartListening()
        val settings = (application as DeadairApp).graph.settings
        val connection = connection ?: PlayerConnection(this).also {
            connection = it
            it.connect()
        }
        drawing?.cancel()
        drawing =
            scope.launch {
                combine(settings.settings, connection.state) { kept, player -> kept to player }
                    .collect { (kept, player) -> draw(tileReading(kept.station != null, player), kept.stationName ?: kept.station?.origin) }
            }
    }

    override fun onStopListening() {
        drawing?.cancel()
        drawing = null
        connection?.release()
        connection = null
        super.onStopListening()
    }

    override fun onClick() {
        super.onClick()
        press(applicationContext, (application as DeadairApp).graph.settings)
    }

    override fun onDestroy() {
        scope.cancel()
        connection?.release()
        connection = null
        super.onDestroy()
    }

    private fun draw(reading: TileReading, stationName: String?) {
        val tile = qsTile ?: return
        tile.icon = Icon.createWithResource(this, R.drawable.ic_radio)
        tile.label = stationName ?: getString(R.string.app_name)
        tile.state =
            when (reading) {
                TileReading.NO_STATION -> Tile.STATE_UNAVAILABLE
                TileReading.STOPPED -> Tile.STATE_INACTIVE
                TileReading.WARMING_UP, TileReading.PLAYING -> Tile.STATE_ACTIVE
            }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.subtitle =
                getString(
                    when (reading) {
                        TileReading.NO_STATION -> R.string.tile_choose_station
                        TileReading.STOPPED -> R.string.tile_off
                        TileReading.WARMING_UP -> R.string.now_warming_up
                        TileReading.PLAYING -> R.string.tile_on
                    },
                )
        }
        tile.updateTile()
    }
}

/**
 * Where a press is carried out, which is NOT the tile's own scope.
 *
 * The tile is bound only while the shade is open, and a press is often the last thing before it
 * closes: `onStopListening` and then `onDestroy` can follow within the second the playback service
 * takes to bind. A press made in the tile's scope would be cancelled by that, and a press that does
 * nothing is the one failure a tile must not have. This scope lives as long as the process does.
 */
private val presses = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

/** How long a press waits for the playback service to bind before giving up on it. */
private const val BIND_WAIT_MS = 5_000L

/**
 * Turn the station over, decided afresh from the kept station and the bound player rather than from
 * whatever the tile last drew: `play()` before the controller has bound is silently nothing.
 */
private fun press(context: Context, settings: SettingsStore) {
    presses.launch {
        val kept = settings.settings.first()
        val connection = PlayerConnection(context)
        try {
            connection.connect()
            val player = withTimeoutOrNull(BIND_WAIT_MS) { connection.state.first { it.connected } } ?: return@launch
            when (tileReading(kept.station != null, player)) {
                TileReading.NO_STATION -> Unit
                TileReading.PLAYING, TileReading.WARMING_UP -> connection.stop()
                TileReading.STOPPED -> connection.play()
            }
        } finally {
            connection.release()
        }
    }
}
