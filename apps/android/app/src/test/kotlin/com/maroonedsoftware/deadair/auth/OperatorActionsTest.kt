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
    private class FakeSession(status: HttpStatusCode, body: String = "{}") : OperatorSession {
        var refreshes = 0
        private val sdk =
            DeadairSdk(
                SdkConfig(
                    baseUrl = "https://radio.example/api",
                    httpClient =
                        HttpClient(MockEngine { respond(content = body, status = status, headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString())) }),
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
}
