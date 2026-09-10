package com.maroonedsoftware.deadair.station

import com.maroonedsoftware.deadair.sdk.DeadairSdk
import com.maroonedsoftware.deadair.sdk.runtime.SdkError
import kotlinx.serialization.MissingFieldException
import kotlinx.serialization.SerializationException
import java.security.cert.CertificateException
import javax.net.ssl.SSLHandshakeException

/** What asking an address whether it is a station got back. */
sealed interface StationCheck {
    /** It answered, and this is what it calls itself. */
    data class Reachable(val stationName: String) : StationCheck

    /**
     * A deadair station, answering a shape this app does not know.
     *
     * Told apart from "not a station" because the two are fixed differently and the wrong message
     * sends somebody to check an address that was right all along. `MissingFieldException` is the
     * signal: it means the body WAS a JSON object and simply lacked fields the contract requires,
     * which is what an older API looks like. A web page or a router's login form fails to parse as
     * JSON at all and lands in the case below.
     */
    data class Incompatible(val missing: String?) : StationCheck

    /** Something is there and it is not a deadair station: a 404, a login page, a router's UI. */
    data class NotAStation(val status: Int?) : StationCheck

    /** Nothing answered: wrong host, wrong port, no network, TLS refused. */
    data class Unreachable(val cause: String?) : StationCheck

    /**
     * Something answered, but this phone does not trust the certificate it presented.
     *
     * Told apart from [Unreachable] because the fix is different: a self-signed or private-CA
     * certificate is an ordinary thing for a self-hosted station to have, and the fix is
     * installing that CA on the phone rather than checking the address or the network.
     */
    data class Untrusted(val cause: String?) : StationCheck
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
        } catch (error: Exception) {
            val untrustedCause = error.untrustedCertificateCause()
            when {
                untrustedCause != null ->
                    // The SDK or Ktor may wrap the TLS failure in something else entirely (even
                    // in SdkError, if a proxy in between answers first) so this is checked ahead
                    // of every other branch rather than caught by type.
                    StationCheck.Untrusted(untrustedCause.message)
                error is SdkError ->
                    // A status the contract does not describe. Something is listening on this
                    // address; it is just not a station.
                    StationCheck.NotAStation(error.status)
                error is MissingFieldException ->
                    // JSON, and an object, and missing something the contract requires. That is a
                    // station running an API this app does not match: almost always one that has
                    // not been redeployed since the client was built.
                    StationCheck.Incompatible(error.missingFields.firstOrNull())
                error is SerializationException ->
                    // A body that would not parse as the contract at all: a web page where JSON
                    // was expected, or JSON of some entirely different shape.
                    StationCheck.NotAStation(null)
                else -> StationCheck.Unreachable(error.message)
            }
        }
}

/**
 * Walks this throwable's cause chain looking for a TLS trust failure, because the SDK or Ktor may
 * wrap it in something else before it reaches [StationProbe.check]. A visited set guards against a
 * cause that cycles back on itself.
 */
private fun Throwable.untrustedCertificateCause(): Throwable? {
    val seen = mutableSetOf<Throwable>()
    var current: Throwable? = this
    while (current != null && seen.add(current)) {
        if (current is SSLHandshakeException || current is CertificateException) return current
        current = current.cause
    }
    return null
}
