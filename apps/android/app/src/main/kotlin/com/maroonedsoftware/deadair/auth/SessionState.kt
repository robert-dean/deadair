package com.maroonedsoftware.deadair.auth

import com.maroonedsoftware.deadair.station.StationUrl

/**
 * Whether this app is signed in to the station it is currently pointed at.
 *
 * Two states and no third. There is deliberately no `Expired`: an access token here lasts thirty
 * days and is refreshed when a call comes back 401 rather than on a clock, so "expired" is not a
 * state a screen can be in — it is a thing that happens inside one request and is over before the
 * caller hears about it.
 */
sealed interface SessionState {
    data object SignedOut : SessionState

    data class SignedIn(val email: String) : SessionState
}

/**
 * Whether a stored session counts for this station.
 *
 * A token belongs to the station that issued it, so pointing the app somewhere else signs it out —
 * not because the old session has ended, but because it is not this station's to honour. Comparing
 * origins rather than clearing the store on change is what makes that answer the same whether the
 * change happened a moment ago or on the last run.
 */
fun sessionFor(stored: StoredSession?, station: StationUrl?): SessionState {
    if (stored == null || station == null) return SessionState.SignedOut
    if (stored.origin != station.origin) return SessionState.SignedOut
    return SessionState.SignedIn(stored.email)
}
