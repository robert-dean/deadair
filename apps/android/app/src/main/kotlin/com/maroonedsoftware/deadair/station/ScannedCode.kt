package com.maroonedsoftware.deadair.station

import java.net.URI
import java.net.URISyntaxException

/**
 * What a scanned code names, if it names a station.
 *
 * The console's code is a `deadair://` link (see [StationLink]), and that is the form this exists
 * for. A plain http or https address is taken too, because a code somebody made for their station
 * by hand will be that. Anything else is refused rather than guessed at: a phone camera pointed at
 * the wrong code reads a Wi-Fi password or a menu, and neither belongs in the address field. An
 * address carrying a user or a password is refused for the reason a link carrying one is.
 */
object ScannedCode {
    fun station(text: String): StationUrl? {
        val trimmed = text.trim()
        StationLink.parse(trimmed)?.let { return it }
        if (!trimmed.startsWith("http://", ignoreCase = true) && !trimmed.startsWith("https://", ignoreCase = true)) return null
        val userInfo =
            try {
                URI(trimmed).rawUserInfo
            } catch (_: URISyntaxException) {
                return null
            }
        if (userInfo != null) return null
        return StationUrl.parse(trimmed).getOrNull()
    }
}
