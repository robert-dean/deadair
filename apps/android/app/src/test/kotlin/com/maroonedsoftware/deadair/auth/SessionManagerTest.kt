package com.maroonedsoftware.deadair.auth

import com.maroonedsoftware.deadair.sdk.DeadairSdk
import com.maroonedsoftware.deadair.sdk.models.PlatformRole
import com.maroonedsoftware.deadair.sdk.runtime.SdkConfig
import com.maroonedsoftware.deadair.settings.ListenerSettings
import com.maroonedsoftware.deadair.station.StationUrl
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.respondError
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The session's policy: what carries the bearer, what a 401 costs, and what ends a session.
 *
 * The store is a plain in-memory double rather than a DataStore, and the SDK is built over a
 * `MockEngine`, so all of this runs on virtual time with no Android runtime and no disk. That is
 * the same split `NowPlayingRepositoryTest` documents: the policy is what has the bugs, and it does
 * not need a real client to be wrong.
 *
 * The single-flight test is the one that matters most. The station's refresh tokens are single-use
 * and a replay revokes every token descended from the same sign-in, so two pollers meeting the same
 * expiry must produce exactly one refresh — not two that happen to work in testing and sign the
 * operator out in the field.
 */
class SessionManagerTest {
    private val station = StationUrl.parse("https://radio.example.com").getOrThrow()

    /** The session store, in memory. */
    private class FakeStore(initial: StoredSession? = null) : SessionStorage {
        val state = MutableStateFlow(initial)
        override val stored: Flow<StoredSession?> get() = state
        var cleared = 0
            private set

        override suspend fun save(session: StoredSession) {
            state.value = session
        }

        override suspend fun clear() {
            cleared += 1
            state.value = null
        }
    }

    private fun signedIn(access: String = "access-1", refresh: String = "refresh-1") =
        StoredSession(origin = station.origin, email = "operator@example.com", accessToken = access, refreshToken = refresh)

    private fun tokenBody(access: String, refresh: String? = "refresh-2") =
        """
        {"result":"token","access_token":"$access"${if (refresh == null) "" else ""","refresh_token":"$refresh""""},
         "expires_in":2592000,"token_type":"Bearer","scope":"platform"}
        """.trimIndent()

    private fun sessionBody(vararg roles: String) = """{"actorId":"u-1","roles":[${roles.joinToString(",") { "\"$it\"" }}]}"""

    private fun MockRequestHandleScope.json(body: String, status: HttpStatusCode = HttpStatusCode.OK): HttpResponseData =
        respond(content = body, status = status, headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()))

    /**
     * The manager under test, over a mock engine.
     *
     * `backgroundScope` rather than the test's own scope, and that is not a detail: the manager
     * keeps a collector running for the life of its scope — the one that drops a token belonging to
     * a station the app has left — and `runTest` waits for every child of the test scope to finish.
     * Handing it `this` hangs the test rather than failing it.
     */
    private fun managerOver(
        store: SessionStorage,
        scope: CoroutineScope,
        station: StationUrl? = this.station,
        handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData,
    ): Pair<SessionManager, MockEngine> {
        val engine = MockEngine(handler)
        val settings = MutableStateFlow(ListenerSettings(station = station))
        val manager =
            SessionManager(
                store = store,
                settings = settings,
                sdkFor = { target, headers -> DeadairSdk(SdkConfig(baseUrl = target.apiBase, headers = headers, httpClient = HttpClient(engine))) },
                scope = scope,
            )
        return manager to engine
    }

    // ── Attaching the bearer ────────────────────────────────────────────────────────────

    @Test
    fun `carries the stored token on every call`() = runTest {
        val store = FakeStore(signedIn())
        val (manager, engine) = managerOver(store, backgroundScope) { json("""{"entries":[]}""") }

        manager.withSession { it.history.readHistory() }

        assertEquals("Bearer access-1", engine.requestHistory.single().headers[HttpHeaders.Authorization])
    }

    @Test
    fun `refuses to call at all when nothing is signed in`() = runTest {
        val store = FakeStore(null)
        val (manager, engine) = managerOver(store, backgroundScope) { json("""{"entries":[]}""") }

        var thrown: Exception? = null
        try {
            manager.withSession { it.history.readHistory() }
        } catch (error: Exception) {
            thrown = error
        }

        assertTrue(thrown is NotSignedInException)
        // Nothing was asked of the station: "signed out" is answered here, not by a 401.
        assertTrue(engine.requestHistory.isEmpty())
    }

    @Test
    fun `refuses when the session belongs to another station`() = runTest {
        val store = FakeStore(signedIn().copy(origin = "https://elsewhere.example.com"))
        val (manager, engine) = managerOver(store, backgroundScope) { json("""{"entries":[]}""") }

        var thrown: Exception? = null
        try {
            manager.withSession { it.history.readHistory() }
        } catch (error: Exception) {
            thrown = error
        }

        assertTrue(thrown is NotSignedInException)
        assertTrue(engine.requestHistory.isEmpty())
    }

    // ── Refreshing ──────────────────────────────────────────────────────────────────────

    @Test
    fun `refreshes once on a 401 and replays the call with the new token`() = runTest {
        val store = FakeStore(signedIn())
        val (manager, engine) =
            managerOver(store, backgroundScope) { request ->
                when {
                    request.url.encodedPath.endsWith("/auth/token") -> json(tokenBody("access-2"))
                    request.headers[HttpHeaders.Authorization] == "Bearer access-1" -> respondError(HttpStatusCode.Unauthorized)
                    else -> json("""{"entries":[]}""")
                }
            }

        val page = manager.withSession { it.history.readHistory() }

        assertTrue(page.entries.isEmpty())
        assertEquals("access-2", store.state.value?.accessToken)
        // The rotated refresh token replaces the spent one, or the next refresh replays a dead one.
        assertEquals("refresh-2", store.state.value?.refreshToken)
        assertEquals(listOf("Bearer access-1", null, "Bearer access-2"), engine.requestHistory.map { it.headers[HttpHeaders.Authorization] })
    }

    @Test
    fun `refreshes exactly once when two calls meet the same expiry`() = runTest {
        // The whole reason the refresh takes a lock. Presenting a spent refresh token does not
        // merely fail — the station revokes every token descended from the same sign-in.
        val store = FakeStore(signedIn())
        val firstIsWaiting = CompletableDeferred<Unit>()
        var refreshes = 0

        val (manager, engine) =
            managerOver(store, backgroundScope) { request ->
                when {
                    request.url.encodedPath.endsWith("/auth/token") -> {
                        refreshes += 1
                        json(tokenBody("access-2"))
                    }
                    request.headers[HttpHeaders.Authorization] == "Bearer access-1" -> {
                        firstIsWaiting.complete(Unit)
                        respondError(HttpStatusCode.Unauthorized)
                    }
                    else -> json("""{"entries":[]}""")
                }
            }

        val one = async { manager.withSession { it.history.readHistory() } }
        firstIsWaiting.await()
        val two = async { manager.withSession { it.history.readHistory() } }
        one.await()
        two.await()

        assertEquals(1, refreshes)
        assertEquals("access-2", store.state.value?.accessToken)
    }

    @Test
    fun `ends the session when the station refuses the refresh token`() = runTest {
        val store = FakeStore(signedIn())
        val (manager, _) =
            managerOver(store, backgroundScope) { request ->
                if (request.url.encodedPath.endsWith("/auth/token")) respondError(HttpStatusCode.Unauthorized)
                else respondError(HttpStatusCode.Unauthorized)
            }

        var thrown: Exception? = null
        try {
            manager.withSession { it.history.readHistory() }
        } catch (error: Exception) {
            thrown = error
        }

        assertTrue(thrown is NotSignedInException)
        assertNull(store.state.value)
        assertEquals(1, store.cleared)
    }

    @Test
    fun `keeps the session when the refresh cannot be reached`() = runTest {
        // A tunnel reconnecting or a phone changing cell is not the end of a session, and treating
        // it as one would sign the operator out several times a day.
        val store = FakeStore(signedIn())
        val (manager, _) =
            managerOver(store, backgroundScope) { request ->
                if (request.url.encodedPath.endsWith("/auth/token")) throw IOException("no route to host")
                respondError(HttpStatusCode.Unauthorized)
            }

        var thrown: Exception? = null
        try {
            manager.withSession { it.history.readHistory() }
        } catch (error: Exception) {
            thrown = error
        }

        assertTrue(thrown is IOException)
        assertEquals(signedIn(), store.state.value)
        assertEquals(0, store.cleared)
    }

    @Test
    fun `keeps the session when the station is merely having a bad minute`() = runTest {
        val store = FakeStore(signedIn())
        val (manager, _) =
            managerOver(store, backgroundScope) { request ->
                if (request.url.encodedPath.endsWith("/auth/token")) respondError(HttpStatusCode.InternalServerError)
                else respondError(HttpStatusCode.Unauthorized)
            }

        try {
            manager.withSession { it.history.readHistory() }
        } catch (error: Exception) {
            // The 500 propagates; what matters is what it did NOT do to the stored session.
        }

        assertEquals(signedIn(), store.state.value)
        assertEquals(0, store.cleared)
    }

    @Test
    fun `lets a failure that is not a 401 through untouched`() = runTest {
        val store = FakeStore(signedIn())
        val (manager, engine) = managerOver(store, backgroundScope) { respondError(HttpStatusCode.Forbidden) }

        try {
            manager.withSession { it.history.readHistory() }
        } catch (error: Exception) {
            // Expected.
        }

        // One call, no refresh: a 403 is the account lacking the role, which no new token fixes.
        assertEquals(1, engine.requestHistory.size)
        assertEquals(signedIn(), store.state.value)
    }

    // ── Signing in and out ──────────────────────────────────────────────────────────────

    @Test
    fun `signs in with the password grant and remembers where the token came from`() = runTest {
        val store = FakeStore(null)
        val (manager, engine) =
            managerOver(store, backgroundScope) { request ->
                if (request.url.encodedPath.endsWith("/auth/session")) json(sessionBody("admin"))
                else json(tokenBody("access-9", refresh = "refresh-9"), HttpStatusCode.Created)
            }

        val result = manager.signIn(station, "operator@example.com", "hunter2")

        assertEquals(SignInResult.Ok, result)
        assertEquals(
            StoredSession(station.origin, "operator@example.com", "access-9", "refresh-9", roles = setOf(PlatformRole.ADMIN)),
            store.state.value,
        )

        // The roles ride one request behind the token, carrying the bearer it just issued.
        val who = engine.requestHistory.last()
        assertTrue(who.url.encodedPath.endsWith("/auth/session"))
        assertEquals("Bearer access-9", who.headers[HttpHeaders.Authorization])

        // Form-encoded, which is what the token endpoint takes and what the generated client sends.
        val body = (engine.requestHistory.first().body as OutgoingContent.ByteArrayContent).bytes().decodeToString()
        assertTrue(body.contains("grant_type=password"))
        assertTrue(body.contains("username=operator%40example.com"))
    }

    @Test
    fun `still signs in when the station cannot say what the account may do`() = runTest {
        // The session is real whether or not the roles read works; the reads will answer or 403
        // on their own. Until the next start asks again, the account draws as a listener.
        val store = FakeStore(null)
        val (manager, _) =
            managerOver(store, backgroundScope) { request ->
                if (request.url.encodedPath.endsWith("/auth/session")) respondError(HttpStatusCode.InternalServerError)
                else json(tokenBody("access-9", refresh = "refresh-9"), HttpStatusCode.Created)
            }

        assertEquals(SignInResult.Ok, manager.signIn(station, "operator@example.com", "hunter2"))
        assertEquals(emptySet<PlatformRole>(), store.state.value?.roles)
    }

    @Test
    fun `reports bad credentials as something the listener can fix`() = runTest {
        val store = FakeStore(null)
        val (manager, _) = managerOver(store, backgroundScope) { respondError(HttpStatusCode.Unauthorized) }

        assertEquals(SignInResult.BadCredentials, manager.signIn(station, "operator@example.com", "wrong"))
        assertNull(store.state.value)
    }

    @Test
    fun `reports an unreachable station as something else`() = runTest {
        val store = FakeStore(null)
        val (manager, _) = managerOver(store, backgroundScope) { throw IOException("no route to host") }

        val result = manager.signIn(station, "operator@example.com", "hunter2")

        assertTrue(result is SignInResult.Failed)
        assertNull(store.state.value)
    }

    @Test
    fun `signs out even when the station cannot be told`() = runTest {
        val store = FakeStore(signedIn())
        val (manager, _) = managerOver(store, backgroundScope) { throw IOException("no route to host") }

        manager.signOut()

        assertNull(store.state.value)
        assertEquals(1, store.cleared)
    }

    @Test
    fun `signs out at the station as well`() = runTest {
        val store = FakeStore(signedIn())
        val (manager, engine) = managerOver(store, backgroundScope) { respond(content = "", status = HttpStatusCode.NoContent) }

        manager.signOut()

        val logout = engine.requestHistory.single()
        assertTrue(logout.url.encodedPath.endsWith("/auth/logout"))
        assertEquals("Bearer access-1", logout.headers[HttpHeaders.Authorization])
        assertNull(store.state.value)
    }

    // ── Roles ───────────────────────────────────────────────────────────────────────────

    @Test
    fun `a refused roles read means no roles, whatever the cache said`() = runTest {
        // The one state the read exists to correct: a cache saying admin about an account the
        // station has just refused.
        val store = FakeStore(signedIn().copy(roles = setOf(PlatformRole.ADMIN)))
        val (manager, _) = managerOver(store, backgroundScope) { respondError(HttpStatusCode.Forbidden) }

        manager.refreshRoles()

        assertEquals(emptySet<PlatformRole>(), store.state.value?.roles)
    }

    @Test
    fun `a roles read that cannot be reached leaves the cache standing`() = runTest {
        val store = FakeStore(signedIn().copy(roles = setOf(PlatformRole.ADMIN)))
        val (manager, _) = managerOver(store, backgroundScope) { throw IOException("no route to host") }

        try {
            manager.refreshRoles()
        } catch (error: IOException) {
            // Expected: a tunnel blip is not a statement about the account.
        }

        assertEquals(setOf(PlatformRole.ADMIN), store.state.value?.roles)
    }

    @Test
    fun `ensures the roles once per process, however many screens ask`() = runTest {
        val store = FakeStore(signedIn())
        var asked = 0
        val (manager, _) =
            managerOver(store, backgroundScope) {
                asked += 1
                json(sessionBody("admin"))
            }

        manager.ensureRoles()
        manager.ensureRoles()

        assertEquals(1, asked)
        assertEquals(setOf(PlatformRole.ADMIN), store.state.value?.roles)
        assertTrue((manager.state.first { it is SessionState.SignedIn } as SessionState.SignedIn).isOperator)
    }

    @Test
    fun `a failed ensure is not remembered as done`() = runTest {
        val store = FakeStore(signedIn())
        var asked = 0
        val (manager, _) =
            managerOver(store, backgroundScope) {
                asked += 1
                if (asked == 1) throw IOException("no route to host") else json(sessionBody("listener"))
            }

        manager.ensureRoles()
        manager.ensureRoles()

        assertEquals(2, asked)
        assertEquals(setOf(PlatformRole.LISTENER), store.state.value?.roles)
    }

    // ── What the screens read ───────────────────────────────────────────────────────────

    @Test
    fun `reports the account a session belongs to`() = runTest {
        val store = FakeStore(signedIn())
        val (manager, _) = managerOver(store, backgroundScope) { json("""{"entries":[]}""") }

        assertEquals(SessionState.SignedIn("operator@example.com"), manager.state.map { it }.first { it is SessionState.SignedIn })
    }

    @Test
    fun `reports signed out when the app is pointed at no station at all`() = runTest {
        val store = FakeStore(signedIn())
        val (manager, _) = managerOver(store, backgroundScope, station = null) { json("""{"entries":[]}""") }

        assertEquals(SessionState.SignedOut, manager.state.first())
    }
}
