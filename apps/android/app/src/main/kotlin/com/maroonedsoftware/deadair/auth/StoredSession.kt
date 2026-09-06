package com.maroonedsoftware.deadair.auth

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
)
