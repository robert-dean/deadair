package com.maroonedsoftware.deadair.settings

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.maroonedsoftware.deadair.station.StationUrl
import com.maroonedsoftware.deadair.station.StreamFormat
import com.maroonedsoftware.deadair.wallpaper.STATION_PALETTE
import com.maroonedsoftware.deadair.wallpaper.ColorSource
import com.maroonedsoftware.deadair.wallpaper.CoverPlacement
import com.maroonedsoftware.deadair.wallpaper.WallpaperFollows
import com.maroonedsoftware.deadair.wallpaper.WallpaperIdle
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
                dynamicColor = stored[DYNAMIC_COLOR] ?: true,
                playOnOpen = stored[PLAY_ON_OPEN] ?: false,
                // And a wallpaper setting this build does not know, on the format's argument.
                wallpaperFollows = stored[WALLPAPER_FOLLOWS]?.let { name -> WallpaperFollows.entries.firstOrNull { it.name == name } } ?: WallpaperFollows.THIS_PHONE,
                wallpaperIdle = stored[WALLPAPER_IDLE]?.let { name -> WallpaperIdle.entries.firstOrNull { it.name == name } } ?: WallpaperIdle.LAST_COVER,
                wallpaperPlacement = stored[WALLPAPER_PLACEMENT]?.let { name -> CoverPlacement.entries.firstOrNull { it.name == name } } ?: CoverPlacement.MIDDLE,
                wallpaperColorSource = stored[WALLPAPER_COLORS]?.let { name -> ColorSource.entries.firstOrNull { it.name == name } } ?: ColorSource.STATION,
                wallpaperColor = stored[WALLPAPER_COLOR] ?: STATION_PALETTE.accent,
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

    suspend fun setDynamicColor(on: Boolean) {
        context.preferences.edit { it[DYNAMIC_COLOR] = on }
    }

    suspend fun setPlayOnOpen(on: Boolean) {
        context.preferences.edit { it[PLAY_ON_OPEN] = on }
    }

    suspend fun setWallpaperFollows(follows: WallpaperFollows) {
        context.preferences.edit { it[WALLPAPER_FOLLOWS] = follows.name }
    }

    suspend fun setWallpaperIdle(idle: WallpaperIdle) {
        context.preferences.edit { it[WALLPAPER_IDLE] = idle.name }
    }

    suspend fun setColorSource(colors: ColorSource) {
        context.preferences.edit { it[WALLPAPER_COLORS] = colors.name }
    }

    /** Pick the color, and follow it: choosing a swatch is what asking for it means. */
    suspend fun setWallpaperPlacement(placement: CoverPlacement) {
        context.preferences.edit { it[WALLPAPER_PLACEMENT] = placement.name }
    }

    suspend fun setWallpaperColor(color: Int) {
        context.preferences.edit {
            it[WALLPAPER_COLOR] = color
            it[WALLPAPER_COLORS] = ColorSource.CUSTOM.name
        }
    }

    private companion object {
        // The KEYS keep their British spelling while the code around them does not, and that is
        // deliberate: these strings are what is written in every listener's DataStore, so renaming
        // one loses the setting it holds on every phone that already has it. They are names on
        // disk rather than words anybody reads.
        val STATION = stringPreferencesKey("station_url")
        val STATION_NAME = stringPreferencesKey("station_name")
        val FORMAT = stringPreferencesKey("stream_format")
        val DYNAMIC_COLOR = booleanPreferencesKey("dynamic_colour")
        val PLAY_ON_OPEN = booleanPreferencesKey("play_on_open")
        val WALLPAPER_FOLLOWS = stringPreferencesKey("wallpaper_follows")
        val WALLPAPER_IDLE = stringPreferencesKey("wallpaper_idle")
        val WALLPAPER_PLACEMENT = stringPreferencesKey("wallpaper_placement")
        val WALLPAPER_COLORS = stringPreferencesKey("wallpaper_colours")
        val WALLPAPER_COLOR = intPreferencesKey("wallpaper_colour")
    }
}
