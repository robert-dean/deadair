package com.maroonedsoftware.deadair.settings

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.maroonedsoftware.deadair.station.StationUrl
import com.maroonedsoftware.deadair.station.StreamFormat
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.preferences: DataStore<Preferences> by preferencesDataStore(name = "listener")

/**
 * The settings, on disk.
 *
 * A `Flow` rather than a read, because everything downstream re-reads on change: pointing the app
 * at a different station has to restart the poll and the player, and doing that by observation
 * rather than by a callback is what keeps the two from disagreeing about which station is current.
 */
class SettingsStore(private val context: Context) {
    val settings: Flow<ListenerSettings> =
        context.preferences.data.map { stored ->
            ListenerSettings(
                // A stored value that will not parse is treated as absent rather than crashing the
                // app on launch: it sends the listener back to the setup screen, which is where
                // they can fix it.
                station = stored[STATION]?.let { StationUrl.parse(it).getOrNull() },
                stationName = stored[STATION_NAME]?.takeIf { it.isNotBlank() },
                // Likewise a format this build does not know, which is what a downgrade looks like.
                format = stored[FORMAT]?.let { name -> StreamFormat.entries.firstOrNull { it.name == name } } ?: StreamFormat.MP3,
            )
        }

    /** Keep a station, and what it called itself when it answered, so the app bar has a name from the first frame. */
    suspend fun setStation(url: StationUrl, name: String?) {
        context.preferences.edit {
            it[STATION] = url.origin
            if (name.isNullOrBlank()) it.remove(STATION_NAME) else it[STATION_NAME] = name
        }
    }

    suspend fun setFormat(format: StreamFormat) {
        context.preferences.edit { it[FORMAT] = format.name }
    }

    private companion object {
        val STATION = stringPreferencesKey("station_url")
        val STATION_NAME = stringPreferencesKey("station_name")
        val FORMAT = stringPreferencesKey("stream_format")
    }
}
