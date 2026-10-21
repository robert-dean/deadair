package com.maroonedsoftware.deadair.playout

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
import io.ktor.http.headersOf
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Skip, on the wire.
 *
 * The screens read the station every two seconds, so the record they show can have ended before a
 * press arrives. A skip from a screen names that record, and the station refuses it (409) rather than
 * cutting the next one; what is pinned here is that the name goes out, that the widget's and the media
 * session's skip goes out without one, and that the refusal is told in words rather than as a number.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TransportTest {
    private class FakeSession(private val asked: MutableList<String?>) : OperatorSession {
        private val sdk =
            DeadairSdk(
                SdkConfig(
                    baseUrl = "https://radio.example/api",
                    httpClient =
                        HttpClient(
                            MockEngine { request ->
                                asked += request.url.parameters["item"]
                                respond(content = "{}", status = HttpStatusCode.Conflict, headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()))
                            },
                        ),
                ),
            )

        override suspend fun <T> withSession(block: suspend (DeadairSdk) -> T): T = block(sdk)

        override suspend fun refreshRoles() = Unit
    }

    private fun transport(scope: CoroutineScope, asked: MutableList<String?>): Pair<Transport, OperatorActions> {
        val actions = OperatorActions(FakeSession(asked))
        val playout =
            PlayoutRepository(
                session = MutableStateFlow<SessionState>(SessionState.SignedIn("operator@example.com")),
                readStatus = { throw IllegalStateException("not asked in this test") },
                readAir = { throw IllegalStateException("not asked in this test") },
                nowEpochMs = { 0L },
                scope = scope,
            )
        return Transport(actions, playout) to actions
    }

    private fun TestScope.heardFrom(actions: OperatorActions): MutableList<Notice> {
        val heard = mutableListOf<Notice>()
        backgroundScope.launch { actions.notices.collect { heard += it } }
        runCurrent()
        return heard
    }

    @Test
    fun `a skip from a screen names the record it showed, and a refusal says it had finished`() = runTest {
        val asked = mutableListOf<String?>()
        val (transport, actions) = transport(backgroundScope, asked)
        val heard = heardFrom(actions)

        transport.skip(onAir = "item-7")
        runCurrent()

        assertEquals(listOf<String?>("item-7"), asked)
        assertEquals(listOf<Notice>(Notice.AlreadyFinished), heard)
    }

    @Test
    fun `a skip with nothing to name asks for whatever is on, as it always did`() = runTest {
        val asked = mutableListOf<String?>()
        val (transport, actions) = transport(backgroundScope, asked)
        val heard = heardFrom(actions)

        transport.skip()
        runCurrent()

        assertNull(asked.single())
        assertEquals(listOf<Notice>(Notice.Failed(409)), heard)
    }
}
