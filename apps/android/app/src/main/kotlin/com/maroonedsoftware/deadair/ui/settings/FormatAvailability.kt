package com.maroonedsoftware.deadair.ui.settings

import com.maroonedsoftware.deadair.sdk.models.NowPlayingMount
import com.maroonedsoftware.deadair.station.StreamFormat

/**
 * Which formats the picker may offer, from what the station says it publishes.
 *
 * **Nothing here connects to a mount to find out.** Under `playout.airMode: audience` a connection
 * is an audience, and the gate lingers five minutes past the last listener — so probing five
 * mounts to populate a settings screen would put a silent station on air and hold it there. That is
 * why `/nowplaying` carries `mounts[]` at all.
 *
 * Before any reading has arrived, everything is offered: greying a format out on no evidence is
 * worse than offering one that turns out to be off, and choosing one that is off falls back to MP3
 * and says so.
 */
fun availableFormats(mounts: List<NowPlayingMount>?): Map<StreamFormat, Boolean> {
    if (mounts == null) return emptyMap()
    val published = mounts.map { it.format }.toSet()
    return StreamFormat.entries.associateWith { it.wire in published }
}
