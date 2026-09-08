package com.maroonedsoftware.deadair.auth

import com.maroonedsoftware.deadair.sdk.models.PlatformRole
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

    /**
     * Signed in, and holding whichever platform roles the station last reported.
     *
     * The roles are a HINT about what to draw and never a gate: the API decides every operation
     * for itself, and a control drawn on the strength of a cached role can still be refused. What
     * they buy is not drawing a Skip button the station is about to say no to.
     */
    data class SignedIn(val email: String, val roles: Set<PlatformRole> = emptySet()) : SessionState {
        /** Whether the station said this account may operate it. `admin` grants everything; `listener` only reads. */
        val isOperator: Boolean get() = PlatformRole.ADMIN in roles
    }
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
    return SessionState.SignedIn(stored.email, stored.roles)
}
