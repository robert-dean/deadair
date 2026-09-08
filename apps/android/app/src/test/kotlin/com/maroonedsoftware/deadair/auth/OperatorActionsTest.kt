package com.maroonedsoftware.deadair.auth

import com.maroonedsoftware.deadair.sdk.DeadairSdk
import com.maroonedsoftware.deadair.sdk.runtime.SdkConfig
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import java.io.IOException
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The one rule every operator action shares: the API is the gate and the cached role is a hint, so
 * a 403 re-reads the roles and says so once rather than failing quietly on every press.
 */
class OperatorActionsTest {
    private class FakeSession(status: HttpStatusCode, body: String = "{}", challenge: String? = null) : OperatorSession {
        var refreshes = 0
        private val sdk =
            DeadairSdk(
                SdkConfig(
                    baseUrl = "https://radio.example/api",
                    httpClient =
                        HttpClient(
                            MockEngine {
                                respond(
                                    content = body,
                                    status = status,
                                    headers =
                                        headersOf(
                                            *buildList {
                                                add(HttpHeaders.ContentType to listOf(ContentType.Application.Json.toString()))
                                                if (challenge != null) add(HttpHeaders.WWWAuthenticate to listOf(challenge))
                                            }.toTypedArray(),
                                        ),
                                )
                            },
                        ),
                ),
            )

        override suspend fun <T> withSession(block: suspend (DeadairSdk) -> T): T = block(sdk)

        override suspend fun refreshRoles() {
            refreshes += 1
        }
    }

    @Test
    fun `answers what the station answered`() = runTest {
        val actions = OperatorActions(FakeSession(HttpStatusCode.OK, """{"actorId":"u-1","roles":["admin"]}"""))

        val session = actions.run { it.authenticationSessions.readSession() }

        assertEquals("u-1", session?.actorId)
    }

    @Test
    fun `a 403 re-reads the roles and says the account is no longer the operator`() = runTest {
        val fake = FakeSession(HttpStatusCode.Forbidden)
        val actions = OperatorActions(fake)
        val heard = mutableListOf<Notice>()
        val listening = backgroundScope.launch { actions.notices.collect { heard += it } }
        runCurrent()

        val answer = actions.run { it.authenticationSessions.readSession() }
        runCurrent()

        assertNull(answer)
        assertEquals(1, fake.refreshes)
        assertEquals(listOf(Notice.NoLongerOperator), heard)
        listening.cancel()
    }

    @Test
    fun `a status the action expected is named rather than numbered`() = runTest {
        val actions = OperatorActions(FakeSession(HttpStatusCode.Conflict))
        val heard = mutableListOf<Notice>()
        val listening = backgroundScope.launch { actions.notices.collect { heard += it } }
        runCurrent()

        actions.run(expected = mapOf(409 to Notice.NothingToResume)) { it.authenticationSessions.readSession() }
        runCurrent()

        assertEquals(listOf(Notice.NothingToResume), heard)
        listening.cancel()
    }

    @Test
    fun `anything else the station refuses is reported with its number`() = runTest {
        val actions = OperatorActions(FakeSession(HttpStatusCode.UnprocessableEntity))
        val heard = mutableListOf<Notice>()
        val listening = backgroundScope.launch { actions.notices.collect { heard += it } }
        runCurrent()

        actions.run { it.authenticationSessions.readSession() }
        runCurrent()

        assertEquals(listOf(Notice.Failed(422)), heard)
        listening.cancel()
    }

    @Test
    fun `no network is its own notice`() = runTest {
        val session =
            object : OperatorSession {
                override suspend fun <T> withSession(block: suspend (DeadairSdk) -> T): T = throw IOException("no route")

                override suspend fun refreshRoles() = Unit
            }
        val actions = OperatorActions(session)
        val heard = mutableListOf<Notice>()
        val listening = backgroundScope.launch { actions.notices.collect { heard += it } }
        runCurrent()

        actions.run { it.authenticationSessions.readSession() }
        runCurrent()

        assertEquals(listOf(Notice.CouldNotReach), heard)
        listening.cancel()
    }

    // ── The 403 that is not a refusal ───────────────────────────────────────────────────

    @Test
    fun `a step-up 403 says the station wants a code, and leaves the roles alone`() = runTest {
        // The opposite state to no-longer-operator: the account still holds the permission, so
        // re-reading the roles would confirm `admin` and change nothing, and the operator would be
        // told they are not the operator while they are.
        val fake = FakeSession(HttpStatusCode.Forbidden, """{"message":"Forbidden","details":{"kind":"step_up_required"}}""")
        val actions = OperatorActions(fake)
        val heard = mutableListOf<Notice>()
        val listening = backgroundScope.launch { actions.notices.collect { heard += it } }
        runCurrent()

        actions.run { it.authenticationSessions.readSession() }
        runCurrent()

        assertEquals(listOf(Notice.StepUpNeeded), heard)
        assertEquals(0, fake.refreshes)
        listening.cancel()
    }

    @Test
    fun `the challenge spelling of the same denial reads the same way`() = runTest {
        // The station sends both, and which one arrives is not this app's to depend on.
        val fake = FakeSession(HttpStatusCode.Forbidden, challenge = """Bearer error="mfa_required"""")
        val actions = OperatorActions(fake)
        val heard = mutableListOf<Notice>()
        val listening = backgroundScope.launch { actions.notices.collect { heard += it } }
        runCurrent()

        actions.run { it.authenticationSessions.readSession() }
        runCurrent()

        assertEquals(listOf(Notice.StepUpNeeded), heard)
        assertEquals(0, fake.refreshes)
        listening.cancel()
    }

    @Test
    fun `only a 403 can be a step-up`() = runTest {
        // A 401 naming `mfa_required` is the token endpoint mid-sign-in, which is a different
        // conversation and never one of these actions.
        val fake = FakeSession(HttpStatusCode.Unauthorized, challenge = """Bearer error="mfa_required"""")
        val actions = OperatorActions(fake)
        val heard = mutableListOf<Notice>()
        val listening = backgroundScope.launch { actions.notices.collect { heard += it } }
        runCurrent()

        actions.run { it.authenticationSessions.readSession() }
        runCurrent()

        assertEquals(listOf(Notice.Failed(401)), heard)
        listening.cancel()
    }
}
