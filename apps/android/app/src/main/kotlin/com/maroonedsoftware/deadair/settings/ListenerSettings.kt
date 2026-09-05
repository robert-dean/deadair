package com.maroonedsoftware.deadair.settings

import com.maroonedsoftware.deadair.station.StationUrl
import com.maroonedsoftware.deadair.station.StreamFormat

/**
 * Everything this app remembers, which is two things.
 *
 * `station` is absent until somebody has named one, which is what the setup screen tests for.
 */
data class ListenerSettings(
    val station: StationUrl? = null,
    val format: StreamFormat = StreamFormat.MP3,
)
