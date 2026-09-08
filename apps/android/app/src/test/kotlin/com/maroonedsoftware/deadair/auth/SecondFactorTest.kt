package com.maroonedsoftware.deadair.auth

import com.maroonedsoftware.deadair.sdk.DeadairSdk
import com.maroonedsoftware.deadair.sdk.models.AuthenticationFactorKind
import com.maroonedsoftware.deadair.sdk.models.AuthenticationFactorMethod
import com.maroonedsoftware.deadair.sdk.models.MfaChallengeFactor
import com.maroonedsoftware.deadair.sdk.runtime.SdkConfig
import com.maroonedsoftware.deadair.settings.ListenerSettings
import com.maroonedsoftware.deadair.station.StationUrl
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Answering a second factor, and the three ways the station refuses one.
 *
 * All three arrive as the same 401 and are told apart only by `WWW-Authenticate`. That is the whole
 * point of these tests: the desktop app shipped without reading it, reported every refusal as "that
 * code was not accepted", and the one report that came back was from an operator whose code was
 * fine — the app had sent it against the wrong factor.
 */
class SecondFactorTest {
    private val station = StationUrl.parse("https://radio.example.com").getOrThrow()

    private class FakeStore : SessionStorage {
        val state = MutableStateFlow<StoredSession?>(null)
        override val stored: Flow<StoredSession?> get() = state

        override suspend fun save(session: StoredSession) {
            state.value = session
        }

        override suspend fun clear() {
            state.value = null
        }
    }

    private fun MockRequestHandleScope.json(body: String, status: HttpStatusCode = HttpStatusCode.OK): HttpResponseData =
        respond(content = body, status = status, headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()))

    /** A 401 that names what it refused, exactly as the token endpoint does. */
    private fun MockRequestHandleScope.refusal(error: String): HttpResponseData =
        respond(
            content = """{"message":"Unauthorized"}""",
            status = HttpStatusCode.Unauthorized,
            headers =
                headersOf(
                    HttpHeaders.ContentType to listOf(ContentType.Application.Json.toString()),
                    HttpHeaders.WWWAuthenticate to listOf("""Bearer error="$error", error_description="the station said so""""),
                ),
        )

    private val challengeBody =
        """
        {"result":"mfa_required","challenge_id":"c_1","expires_at":"2026-09-08T12:00:00Z",
         "factors":[{"method":"email","method_id":"email-1","kind":"possession"},
                    {"method":"authenticator","method_id":"totp-1","kind":"possession"}]}
        """.trimIndent()

    private val tokenBody =
        """{"result":"token","access_token":"access-9","refresh_token":"refresh-9","expires_in":2592000,"token_type":"Bearer","scope":""}"""

    private fun managerOver(
        store: SessionStorage,
        scope: CoroutineScope,
        handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData,
    ): Pair<SessionManager, MockEngine> {
        val engine = MockEngine(handler)
        val manager =
            SessionManager(
                store = store,
                settings = MutableStateFlow(ListenerSettings(station = station)),
                sdkFor = { target, headers -> DeadairSdk(SdkConfig(baseUrl = target.apiBase, headers = headers, httpClient = HttpClient(engine))) },
                scope = scope,
            )
        return manager to engine
    }

    // ── Which factor the code is sent against ───────────────────────────────────────────

    @Test
    fun `picks the authenticator rather than whichever factor is first`() {
        val factors =
            listOf(
                MfaChallengeFactor(AuthenticationFactorMethod.EMAIL, "email-1", AuthenticationFactorKind.POSSESSION),
                MfaChallengeFactor(AuthenticationFactorMethod.AUTHENTICATOR, "totp-1", AuthenticationFactorKind.POSSESSION),
            )

        assertEquals("totp-1", authenticatorFactors(factors).single().methodId)
    }

    @Test
    fun `answers nothing when the account has no authenticator`() {
        // A phone or email factor needs a challenge started against it first, and FIDO needs an
        // assertion this app cannot produce. An empty answer is what lets the screen say so.
        val factors = listOf(MfaChallengeFactor(AuthenticationFactorMethod.EMAIL, "email-1", AuthenticationFactorKind.POSSESSION))

        assertTrue(authenticatorFactors(factors).isEmpty())
    }

    // ── Reading which refusal it was ────────────────────────────────────────────────────

    @Test
    fun `reads the error out of a challenge with other parameters beside it`() {
        assertEquals("invalid_factor", authErrorIn(listOf("""Bearer realm="deadair", error="invalid_factor", error_description="no"""")))
        assertNull(authErrorIn(listOf("Bearer realm=\"deadair\"")))
        assertNull(authErrorIn(emptyList()))
    }

    // ── The exchange ────────────────────────────────────────────────────────────────────

    @Test
    fun `a password step that stops at a challenge is not a failure`() {
        runTest {
            val store = FakeStore()
            val (manager, _) = managerOver(store, backgroundScope) { json(challengeBody) }

            val result = manager.signIn(station, "operator@example.com", "hunter2")

            assertTrue(result is SignInResult.SecondFactorNeeded)
            assertEquals("c_1", (result as SignInResult.SecondFactorNeeded).challengeId)
            // In the station's order, which is enrolment order rather than usefulness order.
            assertEquals(listOf("email-1", "totp-1"), result.factors.map { it.methodId })
            // Nothing is kept: there is no session until the challenge is answered.
            assertNull(store.state.value)
        }
    }

    @Test
    fun `a right code finishes the sign-in and carries the factor it belongs to`() {
        runTest {
            val store = FakeStore()
            val (manager, engine) =
                managerOver(store, backgroundScope) { request ->
                    if (request.url.encodedPath.endsWith("/auth/session")) json("""{"actorId":"u-1","roles":["admin"]}""")
                    else json(tokenBody, HttpStatusCode.Created)
                }

            val result = manager.completeSecondFactor(station, "operator@example.com", "c_1", "totp-1", "123456")

            assertEquals(SignInResult.Ok, result)
            assertEquals("access-9", store.state.value?.accessToken)
            assertEquals("refresh-9", store.state.value?.refreshToken)

            val body = (engine.requestHistory.first().body as OutgoingContent.ByteArrayContent).bytes().decodeToString()
            assertTrue(body.contains("grant_type=authenticator"))
            assertTrue(body.contains("mfa_challenge_id=c_1"))
            assertTrue(body.contains("method_id=totp-1"))
            assertTrue(body.contains("code=123456"))
        }
    }

    @Test
    fun `a wrong code is reported as a wrong code`() {
        runTest {
            val (manager, _) = managerOver(FakeStore(), backgroundScope) { refusal("invalid_grant") }

            assertEquals(SignInResult.BadCredentials, manager.completeSecondFactor(station, "operator@example.com", "c_1", "totp-1", "000000"))
        }
    }

    @Test
    fun `a factor the station will not accept is not a wrong code`() {
        runTest {
            // The bug's own signature: the method id was wrong, not the digits, and reporting it as
            // a bad code sends somebody to re-read their authenticator forever.
            val (manager, _) = managerOver(FakeStore(), backgroundScope) { refusal("invalid_factor") }

            assertEquals(SignInResult.FactorRefused, manager.completeSecondFactor(station, "operator@example.com", "c_1", "email-1", "123456"))
        }
    }

    @Test
    fun `an expired challenge is its own answer`() {
        runTest {
            // A code can be retyped; an expired challenge cannot be answered at all.
            val (manager, _) = managerOver(FakeStore(), backgroundScope) { refusal("invalid_challenge") }

            assertEquals(SignInResult.ChallengeExpired, manager.completeSecondFactor(station, "operator@example.com", "c_1", "totp-1", "123456"))
        }
    }

    @Test
    fun `a refusal that names nothing is treated as a wrong code`() {
        runTest {
            // The remedy that costs least when the guess is wrong: retyping a code is free, and
            // sending somebody back to the password step when the code was merely mistyped is not.
            val (manager, _) =
                managerOver(FakeStore(), backgroundScope) { respond(content = "", status = HttpStatusCode.Unauthorized) }

            assertEquals(SignInResult.BadCredentials, manager.completeSecondFactor(station, "operator@example.com", "c_1", "totp-1", "123456"))
        }
    }
}
