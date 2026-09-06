package com.maroonedsoftware.deadair.settings

import com.maroonedsoftware.deadair.station.StationUrl
import com.maroonedsoftware.deadair.station.StreamFormat

/**
 * Everything this app remembers about how to listen.
 *
 * `station` is absent until somebody has named one, which is what the setup screen tests for.
 * `stationName` is what that station called itself when it was checked, kept so the app bar has a
 * name to show before the first `/nowplaying` answer arrives and while the station is unreachable
 * — the alternative was a raw URL in the title, which is what it drew.
 */
data class ListenerSettings(
    val station: StationUrl? = null,
    val stationName: String? = null,
    val format: StreamFormat = StreamFormat.MP3,
)
