package com.maroonedsoftware.deadair.auth

import com.maroonedsoftware.deadair.sdk.models.PlatformRole

/**
 * A signed-in session, as it survives the app being killed.
 *
 * The origin is part of it rather than beside it. A token is issued by ONE station and means
 * nothing to another, so a session that did not record where it came from would be offered to
 * whatever address the app is pointed at next — which is a 401 at best and somebody else's station
 * reading this listener's bearer at worst.
 *
 * The email is here only to be shown back ("signed in as ..."). Nothing authenticates with it after
 * the first exchange; the tokens do.
 */
data class StoredSession(
    val origin: String,
    val email: String,
    val accessToken: String,
    val refreshToken: String,
    /**
     * What the station said this account may do, as of the last time it was asked. Cached so a
     * cold start knows what to draw before the first network answer; re-read on every start and
     * whenever the station answers 403 to something the cache said was allowed.
     */
    val roles: Set<PlatformRole> = emptySet(),
)
