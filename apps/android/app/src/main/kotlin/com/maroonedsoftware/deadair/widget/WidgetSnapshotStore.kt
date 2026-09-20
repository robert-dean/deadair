package com.maroonedsoftware.deadair.widget

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrackKind
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.widgetSnapshot: DataStore<Preferences> by preferencesDataStore(name = "widget")

/**
 * The snapshot, on disk.
 *
 * A third DataStore file beside `listener` and `session`, for the same reason there is a second: a
 * different lifetime. This one is cleared when the station changes and is rewritten several times
 * an hour, and neither of those may be able to take the kept station or a sign-in with it.
 */
class WidgetSnapshotStore(private val context: Context) {
    val snapshot: Flow<WidgetSnapshot> =
        context.widgetSnapshot.data.map { stored ->
            WidgetSnapshot(
                stationName = stored[STATION_NAME]?.takeIf { it.isNotBlank() },
                onAir = stored[ON_AIR] ?: false,
                reachable = stored[REACHABLE] ?: true,
                // A kind this build does not know is a downgrade, and is treated as a record: the
                // settings do the same with a format, and a record is what a station older than
                // the field ever reported.
                kind = stored[KIND]?.let { name -> NowPlayingTrackKind.entries.firstOrNull { it.name == name } },
                title = stored[TITLE]?.takeIf { it.isNotBlank() },
                artist = stored[ARTIST]?.takeIf { it.isNotBlank() },
                host = stored[HOST]?.takeIf { it.isNotBlank() },
                artworkUrl = stored[ARTWORK]?.takeIf { it.isNotBlank() },
                readAtMs = stored[READ_AT] ?: 0L,
            )
        }

    suspend fun save(snapshot: WidgetSnapshot) {
        context.widgetSnapshot.edit {
            it.put(STATION_NAME, snapshot.stationName)
            it[ON_AIR] = snapshot.onAir
            it[REACHABLE] = snapshot.reachable
            it.put(KIND, snapshot.kind?.name)
            it.put(TITLE, snapshot.title)
            it.put(ARTIST, snapshot.artist)
            it.put(HOST, snapshot.host)
            it.put(ARTWORK, snapshot.artworkUrl)
            it[READ_AT] = snapshot.readAtMs
        }
    }

    /** Everything the old station was playing. Called when the app is pointed somewhere else. */
    suspend fun clear() {
        context.widgetSnapshot.edit { it.clear() }
    }

    /** An absent value is removed rather than written blank, so `takeIf` above is not the only guard. */
    private fun MutablePreferences.put(key: Preferences.Key<String>, value: String?) {
        if (value.isNullOrBlank()) remove(key) else set(key, value)
    }

    private companion object {
        val STATION_NAME = stringPreferencesKey("stationName")
        val ON_AIR = booleanPreferencesKey("onAir")
        val REACHABLE = booleanPreferencesKey("reachable")
        val KIND = stringPreferencesKey("kind")
        val TITLE = stringPreferencesKey("title")
        val ARTIST = stringPreferencesKey("artist")
        val HOST = stringPreferencesKey("host")
        val ARTWORK = stringPreferencesKey("artwork")
        val READ_AT = longPreferencesKey("readAt")
    }
}
