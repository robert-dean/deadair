package com.maroonedsoftware.deadair.auth

import com.maroonedsoftware.deadair.sdk.DeadairSdk
import com.maroonedsoftware.deadair.sdk.models.AuthenticationRequest
import com.maroonedsoftware.deadair.sdk.models.AuthenticationTokenIssued
import com.maroonedsoftware.deadair.sdk.models.AuthenticationTokenResponse
import com.maroonedsoftware.deadair.sdk.models.AuthenticatorAuthenticationRequest
import com.maroonedsoftware.deadair.sdk.models.MfaChallengeFactor
import com.maroonedsoftware.deadair.sdk.models.MfaRequiredResponse
import com.maroonedsoftware.deadair.sdk.models.PasswordAuthenticationRequest
import com.maroonedsoftware.deadair.sdk.models.RefreshTokenAuthenticationRequest
import com.maroonedsoftware.deadair.sdk.runtime.SdkError
import com.maroonedsoftware.deadair.settings.ListenerSettings
import com.maroonedsoftware.deadair.station.StationUrl
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Nothing is signed in, so the call that needed a session was never made. */
class NotSignedInException : Exception("Not signed in to this station")

/** What came of offering an email and a password, or a code against a pending challenge. */
sealed interface SignInResult {
    data object Ok : SignInResult

    /**
     * The station read the credentials — or the code — and said no. The listener can fix this by
     * typing again.
     */
    data object BadCredentials : SignInResult

    /**
     * The station wants a second factor before it will issue anything.
     *
     * A 200 rather than an error, which is why signing in answers with a result type instead of
     * throwing: a client reading the status alone sees a successful sign-in with no token in it.
     * The challenge is satisfied by posting a proof grant carrying [challengeId], and [factors]
     * lists every factor that would satisfy it — of which this app can answer the authenticator
     * and nothing else. See `authenticatorFactors`.
     */
    data class SecondFactorNeeded(val challengeId: String, val factors: List<MfaChallengeFactor>) : SignInResult

    /**
     * The challenge is gone: it expired, or it was already spent.
     *
     * Told apart from a wrong code because the remedy is different. A code can be retyped; an
     * expired challenge cannot be answered at all, and the password step has to be done again.
     */
    data object ChallengeExpired : SignInResult

    /**
     * The station will not accept that factor for this challenge, which is almost always a bug
     * here rather than anything the operator did: the method id sent with the code was not one of
     * the challenge's eligible authenticators.
     */
    data object FactorRefused : SignInResult

    /**
     * A token with nothing to renew it from. Refused rather than kept, because the session would
     * otherwise end when the access token does, with no way back and nothing said at the time.
     */
    data object NoRefreshToken : SignInResult

    /** Anything else: no network, a station that is down. Carries the diagnostic, which is never shown. */
    data class Failed(val message: String?) : SignInResult
}

/**
 * The signed-in half of the app.
 *
 * **Listening needs none of this.** `/nowplaying` and the mounts are public, which is the whole
 * design of the station's edge, so an install that never signs in loses nothing it came for. What a
 * session buys is the station's own account of itself — what it played, what is on next — which
 * sits behind `platform.view` because it is the console's data being read by a phone.
 *
 * ## The token is attached per request, not per SDK
 *
 * `SdkConfig.headers` is a `suspend` lambda the runtime calls once per request, so the bearer is
 * read at the moment of the call rather than baked in when the client was built. That is what lets
 * a retry after a refresh carry the NEW token through the same `DeadairSdk` instance, and it is why
 * nothing here has to rebuild a client to change a header.
 *
 * ## Why a refresh is single-flight
 *
 * The station's refresh tokens are single-use and rotating, and presenting a spent one **revokes
 * the whole family** — every token descended from that sign-in, at once. Two pollers hitting 401 in
 * the same second is the ordinary case here rather than a race worth ignoring: the history screen
 * and the schedule screen both poll, and a token that has just expired expires for both of them.
 * So refreshing takes a lock, and the first thing it does inside the lock is check whether the
 * token it set out to replace is still the current one. If it is not, somebody else has already
 * refreshed and their answer is the good one — taking a second turn would be exactly the replay the
 * station treats as theft.
 *
 * ## What ends a session and what does not
 *
 * A 4xx to the refresh ends it: the token is spent, revoked, or the account is gone, and no amount
 * of retrying makes any of those better. A network failure does NOT — a tunnel reconnecting or a
 * phone changing cell would otherwise sign the operator out several times a day — and neither does
 * a 5xx, which is the station having a bad minute rather than a statement about this session.
 */
class SessionManager(
    private val store: SessionStorage,
    private val settings: Flow<ListenerSettings>,
    /**
     * One SDK for one station, carrying whatever headers it is handed. A function rather than the
     * client itself, for the reason `NowPlayingRepository` takes one: what this class is FOR is the
     * policy, and none of it needs an HTTP stack to be exercised.
     */
    private val sdkFor: (StationUrl, suspend () -> Map<String, String>) -> DeadairSdk,
    scope: CoroutineScope,
) : OperatorSession {
    private val refreshLock = Mutex()

    /** Guards `ensureRoles`, so two screens coming up together ask the station once. */
    private val ensureLock = Mutex()
    private var rolesEnsuredFor: String? = null

    val state: StateFlow<SessionState> =
        combine(settings.map { it.station }.distinctUntilChanged(), store.stored) { station, stored -> sessionFor(stored, station) }
            .stateIn(scope, SharingStarted.WhileSubscribed(SUBSCRIBER_GRACE_MS), SessionState.SignedOut)

    init {
        // A token for a station this app is no longer pointed at is not merely unusable, it is
        // something to be rid of: `sessionFor` already reports it as signed out, so keeping the
        // bytes on disk buys nothing and leaves one station's bearer sitting in an install now
        // aimed at another.
        scope.launch {
            combine(settings.map { it.station }.distinctUntilChanged(), store.stored) { station, stored -> station to stored }
                .collect { (station, stored) ->
                    if (stored != null && station != null && stored.origin != station.origin) store.clear()
                }
        }
    }

    /** Exchange an email and a password for a session. The password is not kept, here or anywhere. */
    suspend fun signIn(station: StationUrl, email: String, password: String): SignInResult {
        val answer =
            try {
                requestToken(station, PasswordAuthenticationRequest(username = email, password = password))
            } catch (error: SdkError) {
                // The token endpoint answers 400 for a grant it will not honour and 401 for
                // credentials it read and rejected. Both are the same thing to a listener, and
                // both are fixed by typing again.
                return if (error.status in CREDENTIAL_REFUSALS) SignInResult.BadCredentials else SignInResult.Failed(error.message)
            } catch (error: Exception) {
                return SignInResult.Failed(error.message)
            }

        return accept(station, email, answer)
    }

    /**
     * Answer a pending challenge with a code from an authenticator app.
     *
     * [methodId] is the id of the factor the code belongs to and has to be one the challenge
     * listed: TOTP has no other binding to the actor at initial login, so the station cannot work
     * out which authenticator six digits are supposed to be from. Sending the wrong one is refused
     * as `invalid_factor`, and reporting THAT as a bad code is what sends somebody to re-read their
     * authenticator forever.
     */
    suspend fun completeSecondFactor(
        station: StationUrl,
        email: String,
        challengeId: String,
        methodId: String,
        code: String,
    ): SignInResult {
        val answer =
            try {
                requestToken(station, AuthenticatorAuthenticationRequest(code = code, mfaChallengeId = challengeId, methodId = methodId))
            } catch (error: SdkError) {
                if (error.status !in CREDENTIAL_REFUSALS) return SignInResult.Failed(error.message)
                // Three different refusals arrive as one status, and the station names which in
                // `WWW-Authenticate`. Reading it is the difference between telling somebody their
                // code was wrong and telling them their sign-in has expired.
                return when (error.authError) {
                    INVALID_CHALLENGE -> SignInResult.ChallengeExpired
                    INVALID_FACTOR -> SignInResult.FactorRefused
                    else -> SignInResult.BadCredentials
                }
            } catch (error: Exception) {
                return SignInResult.Failed(error.message)
            }

        return accept(station, email, answer)
    }

    /**
     * Keep whatever the token endpoint answered with, whichever grant asked for it.
     *
     * Shared by the password step and the code step because the second half of a sign-in is the
     * same either way, and the arm that is NOT a token is the whole reason both steps exist.
     */
    private suspend fun accept(station: StationUrl, email: String, answer: AuthenticationTokenResponse): SignInResult {
        if (answer is MfaRequiredResponse) return SignInResult.SecondFactorNeeded(answer.challengeId, answer.factors)
        if (answer !is AuthenticationTokenIssued) return SignInResult.Failed(null)

        val refreshToken = answer.refreshToken ?: return SignInResult.NoRefreshToken

        store.save(StoredSession(origin = station.origin, email = email, accessToken = answer.accessToken, refreshToken = refreshToken))

        // The roles ride one request behind the tokens. A failure here is not a failed sign-in —
        // the session is real and the reads will work or 403 on their own — so it is swallowed
        // and the next start asks again. Until then the account draws as a listener.
        runCatching { refreshRoles() }
        return SignInResult.Ok
    }

    /** Unauthenticated, because none of the grants that reach it have a session yet by definition. */
    private suspend fun requestToken(station: StationUrl, request: AuthenticationRequest): AuthenticationTokenResponse =
        sdkFor(station) { emptyMap() }.authentication.requestToken(request)

    /**
     * Ask the station which platform roles this account holds, and remember the answer.
     *
     * A 403 is an answer: the account holds no role at all, which is what any account that did
     * not come in through onboarding looks like. It is stored as no roles rather than left as
     * whatever was cached, because a cache saying `admin` about an account the station has just
     * refused is the one state this method exists to correct.
     */
    override suspend fun refreshRoles() {
        val roles =
            try {
                withSession { it.authenticationSessions.readSession() }.roles.toSet()
            } catch (error: SdkError) {
                if (error.status != FORBIDDEN) throw error
                emptySet()
            }
        val current = store.stored.first() ?: return
        if (current.roles != roles) store.save(current.copy(roles = roles))
    }

    /**
     * Refresh the roles once per process for the session that is signed in.
     *
     * Called when the app comes up with a session already on disk, so a role granted or taken
     * away since the last run is noticed without waiting for a 403. Once per session rather than
     * once per screen, because the answer changes when an operator edits a tuple by hand and not
     * otherwise. A failure leaves the cached roles standing and is not remembered as done, so the
     * next start tries again.
     */
    suspend fun ensureRoles() {
        val current = store.stored.first() ?: return
        val key = "${current.origin}|${current.email}"
        ensureLock.withLock {
            if (rolesEnsuredFor == key) return
            runCatching { refreshRoles() }.onSuccess { rolesEnsuredFor = key }
        }
    }

    /**
     * End the session, here and at the station.
     *
     * The local clear happens whatever the station says, and is not conditional on the call
     * succeeding: a listener who has asked to be signed out is signed out, and an unreachable
     * station is not a reason to keep their tokens on this phone.
     */
    suspend fun signOut() {
        val station = settings.first().station
        val session = store.stored.first()

        if (station != null && session != null && session.origin == station.origin) {
            try {
                sdkFor(station) { mapOf(AUTHORIZATION to bearer(session.accessToken)) }.authenticationSessions.logout()
            } catch (error: Exception) {
                // Best effort. The station revokes the session on its side if it hears about it,
                // and forgets it in thirty days if it does not.
            }
        }

        store.clear()
    }

    /**
     * Run one call as the signed-in listener, refreshing once if the station says the token is old.
     *
     * Throws `NotSignedInException` when there is no session for the current station, rather than
     * answering with something empty: "signed out" and "nothing to show" are different screens, and
     * a caller that cannot tell them apart draws the wrong one.
     */
    override suspend fun <T> withSession(block: suspend (DeadairSdk) -> T): T {
        val station = settings.first().station ?: throw NotSignedInException()
        val session = store.stored.first() ?: throw NotSignedInException()
        if (session.origin != station.origin) throw NotSignedInException()

        // Captured by the header lambda below, so the retry sends the token the refresh produced
        // through the very same client rather than needing a second one.
        var token = session.accessToken
        val sdk = sdkFor(station) { mapOf(AUTHORIZATION to bearer(token)) }

        return try {
            block(sdk)
        } catch (error: SdkError) {
            if (error.status != UNAUTHORIZED) throw error
            val renewed = refreshed(station, spent = token) ?: throw NotSignedInException()
            token = renewed.accessToken
            // Once. A second 401 on a token the station has just issued is the station saying
            // something other than "this is old", and repeating the call would not find out what.
            block(sdk)
        }
    }

    /**
     * Trade the refresh token for a new pair, at most one caller at a time.
     *
     * Answers the session to carry on with, or `null` when there is none to be had — in which case
     * the store has already been cleared and `state` has already said so.
     */
    private suspend fun refreshed(station: StationUrl, spent: String): StoredSession? =
        refreshLock.withLock {
            val current = store.stored.first() ?: return@withLock null

            // Somebody refreshed while this call waited for the lock. Their token is the live one
            // and this call's is simply out of date; presenting the refresh token again would be
            // the replay that revokes the family.
            if (current.accessToken != spent) return@withLock current

            val answer =
                try {
                    sdkFor(station) { emptyMap() }
                        .authentication
                        .requestToken(RefreshTokenAuthenticationRequest(refreshToken = current.refreshToken))
                } catch (error: SdkError) {
                    // Spent, revoked, or the account is gone. None of those improve on a retry.
                    // A 5xx is the station having a bad minute and says nothing about this
                    // session, so it is rethrown rather than treated as the end of one.
                    if (error.status in CLIENT_ERRORS) {
                        store.clear()
                        return@withLock null
                    }
                    throw error
                }

            if (answer !is AuthenticationTokenIssued) {
                store.clear()
                return@withLock null
            }

            // A rotation answers with both halves. Keeping the old refresh token when it does not
            // is the safe way round: presenting one the station has already retired costs a 401,
            // while dropping a good one costs the session.
            val next = current.copy(accessToken = answer.accessToken, refreshToken = answer.refreshToken ?: current.refreshToken)
            store.save(next)
            next
        }

    private companion object {
        const val AUTHORIZATION = "Authorization"
        const val UNAUTHORIZED = 401
        const val FORBIDDEN = 403
        val CLIENT_ERRORS = 400..499

        /** A grant the station will not honour, and one it read and rejected. Both are retyped. */
        val CREDENTIAL_REFUSALS = setOf(400, UNAUTHORIZED)

        /** As long as `NowPlayingRepository` holds its poll open for, and for the same reasons. */
        const val SUBSCRIBER_GRACE_MS = 5_000L

        fun bearer(token: String) = "Bearer $token"
    }
}
