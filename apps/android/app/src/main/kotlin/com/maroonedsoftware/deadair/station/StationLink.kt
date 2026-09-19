package com.maroonedsoftware.deadair.station

import java.net.URI
import java.net.URISyntaxException
import java.net.URLDecoder

/**
 * A `deadair://` link, which names a station for the app to be pointed at.
 *
 * The desktop app's grammar exactly (`Core/Station/StationLink.cs`), so one link the console writes
 * opens whichever of the two is installed. Two forms. `deadair://connect?station=<origin>` carries
 * the whole origin, escaped, and is what the console writes: it is the only form that can name a
 * plain-http station on a home network, which is where most of these run. `deadair://radio.example.com`
 * is shorthand for an https station, for somebody typing one by hand. Anything else is refused
 * rather than guessed at, and so is anything carrying a user or a password: a link names a place,
 * never a way in.
 *
 * A link only ever PROPOSES a station. The app shows its setup screen with the address filled in and
 * connects when somebody presses Connect, so a link in an email cannot quietly repoint an app.
 *
 * `java.net.URI` rather than `android.net.Uri`, so it is tested on the JVM with everything else.
 */
object StationLink {
    const val SCHEME = "deadair"
    private const val CONNECT_HOST = "connect"

    /** The station a link names, or `null` for anything this app does not write. */
    fun parse(text: String?): StationUrl? {
        if (text.isNullOrBlank()) return null
        val link =
            try {
                URI(text)
            } catch (error: URISyntaxException) {
                return null
            }
        if (!SCHEME.equals(link.scheme, ignoreCase = true) || link.isOpaque || link.rawUserInfo != null) return null

        if (CONNECT_HOST.equals(link.host, ignoreCase = true)) {
            val origin = query(link, "station")?.takeIf { it.isNotEmpty() && "://" in it } ?: return null
            if (carriesUser(origin)) return null
            return StationUrl.parse(origin).getOrNull()
        }

        // The shorthand: a host and nothing else. A path or a query on it is not something this app
        // writes, so it is not something to interpret.
        val authority = link.rawAuthority
        if (authority.isNullOrEmpty() || link.rawQuery != null || link.rawFragment != null || link.rawPath !in setOf("", "/")) return null
        return StationUrl.parse("https://$authority").getOrNull()
    }

    /** Whether an escaped origin smuggles in what the link's own authority is refused for. */
    private fun carriesUser(origin: String): Boolean =
        try {
            URI(origin).rawUserInfo != null
        } catch (error: URISyntaxException) {
            true
        }

    /**
     * What a link proposes, given the station already kept: `null` when it names that same station,
     * which closes the question rather than asking it again.
     */
    fun proposal(link: StationUrl, kept: StationUrl?): StationUrl? = link.takeIf { it.origin != kept?.origin }

    private fun query(link: URI, name: String): String? {
        for (pair in link.rawQuery.orEmpty().split('&')) {
            if (pair.isEmpty()) continue
            val key = decode(pair.substringBefore('='))
            if (key == name) return if ('=' in pair) decode(pair.substringAfter('=')) else ""
        }
        return null
    }

    /**
     * `+` is a space, as a form encodes one, which is how the desktop reads it too. The charset is
     * named as a string because the `Charset` overload arrived in API 33 and this app starts at 26.
     */
    private fun decode(text: String): String? =
        try {
            URLDecoder.decode(text, "UTF-8")
        } catch (error: IllegalArgumentException) {
            null
        }
}
