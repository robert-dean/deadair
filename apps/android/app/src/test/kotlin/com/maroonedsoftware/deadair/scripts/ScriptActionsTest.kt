package com.maroonedsoftware.deadair.scripts

import com.maroonedsoftware.deadair.auth.Notice
import com.maroonedsoftware.deadair.auth.OperatorActions
import com.maroonedsoftware.deadair.auth.OperatorSession
import com.maroonedsoftware.deadair.sdk.DeadairSdk
import com.maroonedsoftware.deadair.sdk.models.ScriptRating
import com.maroonedsoftware.deadair.sdk.runtime.SdkConfig
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The operator's opinion of something the station said.
 *
 * Unlike the other actions this one answers with what the station stored rather than a yes or no,
 * because the Scripts screen replaces its row with it. So the test that matters is that the answer
 * DECODES: a row that came back null on a success would put the old rating back under the operator's
 * thumb and say nothing.
 */
class ScriptActionsTest {
    private val attemptId = "0c9f3e1a-7b2d-4e8f-a1c3-5d6e7f809a1b"

    private val attemptJson =
        """{"id":"$attemptId","at":"2026-09-06T20:00:00Z","kind":"link","writer":"model","outcome":"written","script":"words a","rating":"liked"}"""

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

    @Test
    fun `a rating answers with the attempt the station kept`() = runTest {
        val recorded = Recorded()
        val actions = ScriptActions(OperatorActions(FakeSession(recorded, HttpStatusCode.OK, attemptJson)))

        val kept = actions.rate(attemptId, ScriptRating.LIKED)

        assertEquals("/api/scripts/$attemptId/rating", recorded.path)
        assertEquals("""{"rating":"liked"}""", recorded.body)
        assertEquals(attemptId, kept?.id)
        assertEquals(ScriptRating.LIKED, kept?.rating)
    }

    @Test
    fun `a refusal answers nothing and says why`() = runTest {
        val fake = FakeSession(Recorded(), HttpStatusCode.Forbidden, "{}")
        val operator = OperatorActions(fake)
        val heard = mutableListOf<Notice>()
        backgroundScope.launch { operator.notices.collect { heard += it } }
        runCurrent()

        assertNull(ScriptActions(operator).rate(attemptId, ScriptRating.DISLIKED))
        runCurrent()

        assertEquals(1, fake.refreshes)
        assertEquals(listOf(Notice.NoLongerOperator), heard)
    }

    @Test
    fun `an attempt the station has lost is reported by its status`() = runTest {
        val operator = OperatorActions(FakeSession(Recorded(), HttpStatusCode.NotFound, "{}"))
        val heard = mutableListOf<Notice>()
        backgroundScope.launch { operator.notices.collect { heard += it } }
        runCurrent()

        assertNull(ScriptActions(operator).rate(attemptId, ScriptRating.LIKED))
        runCurrent()

        assertEquals(listOf(Notice.Failed(404)), heard)
    }
}
