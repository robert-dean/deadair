package com.maroonedsoftware.deadair.station

import com.maroonedsoftware.deadair.sdk.DeadairSdk
import com.maroonedsoftware.deadair.sdk.runtime.SdkError

/** What asking an address whether it is a station got back. */
sealed interface StationCheck {
    /** It answered, and this is what it calls itself. */
    data class Reachable(val stationName: String) : StationCheck

    /** Something is there and it is not a deadair station: a 404, a login page, a router's UI. */
    data class NotAStation(val status: Int?) : StationCheck

    /** Nothing answered: wrong host, wrong port, no network, TLS refused. */
    data class Unreachable(val cause: String?) : StationCheck
}

/**
 * Whether an address is a station, asked before the app agrees to remember it.
 *
 * Through `/nowplaying` because it is the one deliberately public route: it needs no session, it
 * answers 200 on a quiet station rather than a 404, and it names the station — so one call both
 * proves the address and gives the listener something to recognise. A typo that reaches somebody
 * else's web server is told apart from a typo that reaches nothing, because those are different
 * mistakes and the listener fixes them differently.
 */
class StationProbe(private val sdkFor: (StationUrl) -> DeadairSdk) {
    suspend fun check(station: StationUrl): StationCheck =
        try {
            StationCheck.Reachable(sdkFor(station).nowplaying.getNowPlaying().station)
        } catch (error: SdkError) {
            // A status the contract does not describe. Something is listening on this address; it
            // is just not a station.
            StationCheck.NotAStation(error.status)
        } catch (error: Exception) {
            // Everything else, which is either the transport failing or a body that would not
            // decode — a web page where JSON was expected. Both mean "not this address".
            if (error is kotlinx.serialization.SerializationException) StationCheck.NotAStation(null) else StationCheck.Unreachable(error.message)
        }
}
