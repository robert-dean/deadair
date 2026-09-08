package com.maroonedsoftware.deadair.director

import com.maroonedsoftware.deadair.auth.Notice
import com.maroonedsoftware.deadair.auth.OperatorActions
import com.maroonedsoftware.deadair.auth.OperatorSession
import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.sdk.DeadairSdk
import com.maroonedsoftware.deadair.sdk.runtime.SdkConfig
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Handing the broadcast to somebody else.
 *
 * The case worth a test of its own is the empty body: handing it BACK to the station's own host is
 * `personaId` absent, and the generated SDK is what turns a Kotlin `null` into an absent field. A
 * change to that setting would otherwise be found by an operator, on air.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class OrderActionsTest {
    private fun orderJson(name: String, personaLabel: String? = null) =
        """{"name":"$name","mode":"rotation","onEnd":"extend","source":"director",""" +
            (personaLabel?.let { """"personaLabel":"$it",""" } ?: "") +
            """"items":[]}"""

    private class Recorded {
        var path: String? = null
        var body: String? = null
    }

    private class FakeSession(private val recorded: Recorded, status: HttpStatusCode, body: String) : OperatorSession {
        var refreshes = 0
        private val sdk =
            DeadairSdk(
                SdkConfig(
                    baseUrl = "https://radio.example/api",
                    httpClient =
                        HttpClient(
                            MockEngine { request ->
                                recorded.path = request.url.encodedPath
                                recorded.body = (request.body as? TextContent)?.text
                                respond(content = body, status = status, headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()))
                            },
                        ),
                ),
            )

        override suspend fun <T> withSession(block: suspend (DeadairSdk) -> T): T = block(sdk)

        override suspend fun refreshRoles() {
            refreshes += 1
        }
    }

    private fun repositoryFor(scope: CoroutineScope, reads: () -> Unit = {}) =
        OrderRepository(
            session = MutableStateFlow<SessionState>(SessionState.SignedIn("operator@example.com")),
            read = {
                reads()
                com.maroonedsoftware.deadair.sdk.models.StationOrder(
                    name = "Polled",
                    mode = com.maroonedsoftware.deadair.sdk.models.StationMode.ROTATION,
                    onEnd = com.maroonedsoftware.deadair.sdk.models.StationOnEnd.EXTEND,
                    source = "director",
                    items = emptyList(),
                )
            },
            nowEpochMs = { 0L },
            scope = scope,
        )

    @Test
    fun `handing the broadcast back to the station's host sends an empty body`() = runTest {
        val recorded = Recorded()
        val actions = OrderActions(OperatorActions(FakeSession(recorded, HttpStatusCode.OK, orderJson("Answered"))), repositoryFor(backgroundScope))

        assertTrue(actions.recast(null))

        assertEquals("/api/director/air/persona", recorded.path)
        assertEquals("{}", recorded.body)
    }

    @Test
    fun `handing it to a persona sends that persona's id`() = runTest {
        val recorded = Recorded()
        val actions = OrderActions(OperatorActions(FakeSession(recorded, HttpStatusCode.OK, orderJson("Answered", personaLabel = "Cass"))), repositoryFor(backgroundScope))

        assertTrue(actions.recast("p-2"))

        assertEquals("""{"personaId":"p-2"}""", recorded.body)
    }

    @Test
    fun `a replan is only asked for, because the station answers it with nothing`() = runTest {
        val recorded = Recorded()
        val actions = OrderActions(OperatorActions(FakeSession(recorded, HttpStatusCode.Accepted, "")), repositoryFor(backgroundScope))

        assertTrue(actions.replan(com.maroonedsoftware.deadair.sdk.models.ReplanStationInput(brief = "heavy metal hits")))

        assertEquals("/api/director/air/replan", recorded.path)
        assertEquals("""{"brief":"heavy metal hits"}""", recorded.body)
    }

    @Test
    fun `a persona the station no longer has is reported as gone rather than as a number`() = runTest {
        val operator = OperatorActions(FakeSession(Recorded(), HttpStatusCode.NotFound, "{}"))
        val actions = OrderActions(operator, repositoryFor(backgroundScope))
        val heard = mutableListOf<Notice>()
        backgroundScope.launch { operator.notices.collect { heard += it } }
        runCurrent()

        assertFalse(actions.recast("gone"))
        runCurrent()

        assertEquals(listOf(Notice.HostGone), heard)
    }

}
