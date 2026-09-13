package com.maroonedsoftware.deadair.playback

import com.maroonedsoftware.deadair.settings.ListenerSettings

/**
 * Whether opening the app should start the station: `null` while that cannot be decided yet.
 *
 * Undecidable until the player is bound and the settings have been read, because `play()` before the
 * controller exists is silently nothing, and settings not yet read are not a setting that is off.
 * Once both are known it is yes only with the setting on, a station kept, and nothing already
 * playing: a return to an app that is already playing is not an open.
 */
fun playOnOpen(connected: Boolean, settings: ListenerSettings?, requested: Boolean): Boolean? {
    if (!connected || settings == null) return null
    return settings.playOnOpen && settings.station != null && !requested
}
