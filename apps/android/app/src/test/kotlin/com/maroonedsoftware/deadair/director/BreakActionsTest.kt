package com.maroonedsoftware.deadair.director

import com.maroonedsoftware.deadair.auth.Notice
import com.maroonedsoftware.deadair.auth.OperatorActions
import com.maroonedsoftware.deadair.auth.OperatorSession
import com.maroonedsoftware.deadair.sdk.DeadairSdk
import com.maroonedsoftware.deadair.sdk.models.RequestableBreakKind
import com.maroonedsoftware.deadair.sdk.runtime.SdkConfig
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Asking the station to say something.
 *
 * The case worth guarding is the decline: it is a 200, so nothing in the shared failure path says
 * it, and a press the station turned down would otherwise look exactly like one it took.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BreakActionsTest {
    private class Recorded {
        var path: String? = null
        var body: String? = null
    }

    private class FakeSession(private val recorded: Recorded, status: HttpStatusCode, body: String) : OperatorSession {
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

        override suspend fun refreshRoles() {}
    }

    private fun TestScope.listen(operator: OperatorActions): MutableList<Notice> {
        val heard = mutableListOf<Notice>()
        backgroundScope.launch { operator.notices.collect { heard += it } }
        runCurrent()
        return heard
    }

    @Test
    fun `asking for the news asks for it next, and says it was taken`() = runTest {
        val recorded = Recorded()
        val operator = OperatorActions(FakeSession(recorded, HttpStatusCode.OK, """{"accepted":true,"requestId":"r-1","segmentId":"s-1"}"""))
        val heard = listen(operator)

        assertTrue(BreakActions(operator).request(RequestableBreakKind.NEWS))
        runCurrent()

        assertEquals("/api/director/air/breaks", recorded.path)
        assertEquals("""{"kind":"news","urgency":"next"}""", recorded.body)
        assertEquals(listOf<Notice>(Notice.BreakAsked(RequestableBreakKind.NEWS)), heard)
    }

    @Test
    fun `a decline is said with the station's own reason`() = runTest {
        val operator =
            OperatorActions(FakeSession(Recorded(), HttpStatusCode.OK, """{"accepted":false,"reason":"the station has been told not to interrupt itself"}"""))
        val heard = listen(operator)

        assertFalse(BreakActions(operator).request(RequestableBreakKind.WEATHER))
        runCurrent()

        assertEquals(listOf<Notice>(Notice.BreakDeclined("the station has been told not to interrupt itself")), heard)
    }

    @Test
    fun `a decline with no reason is still said`() = runTest {
        val operator = OperatorActions(FakeSession(Recorded(), HttpStatusCode.OK, """{"accepted":false}"""))
        val heard = listen(operator)

        assertFalse(BreakActions(operator).request(RequestableBreakKind.TALKBREAK))
        runCurrent()

        assertEquals(listOf<Notice>(Notice.BreakDeclined(null)), heard)
    }

    @Test
    fun `a refusal goes through the shared path and is said once`() = runTest {
        val operator = OperatorActions(FakeSession(Recorded(), HttpStatusCode.InternalServerError, "{}"))
        val heard = listen(operator)

        assertFalse(BreakActions(operator).request(RequestableBreakKind.NEWS))
        runCurrent()

        assertEquals(listOf<Notice>(Notice.Failed(500)), heard)
    }
}
