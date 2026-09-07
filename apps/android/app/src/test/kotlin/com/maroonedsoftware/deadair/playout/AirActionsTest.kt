package com.maroonedsoftware.deadair.playout

import com.maroonedsoftware.deadair.auth.Notice
import com.maroonedsoftware.deadair.auth.OperatorActions
import com.maroonedsoftware.deadair.auth.OperatorSession
import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.director.OrderRepository
import com.maroonedsoftware.deadair.sdk.DeadairSdk
import com.maroonedsoftware.deadair.sdk.models.StationMode
import com.maroonedsoftware.deadair.sdk.models.StationOnEnd
import com.maroonedsoftware.deadair.sdk.models.StationOrder
import com.maroonedsoftware.deadair.sdk.runtime.SdkConfig
import com.maroonedsoftware.deadair.ui.plan.PlanForm
import com.maroonedsoftware.deadair.ui.plan.PlanScope
import com.maroonedsoftware.deadair.ui.plan.PlanUiState
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
 * Putting the station on air on a broadcast built from the operator's own words.
 *
 * What this pins that the pure state cannot is the WIRE: the generated SDK drops an absent field
 * rather than sending a null, and a station that received `"personaId": null` would be told
 * something different from what the operator chose.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AirActionsTest {
    private val airJson = """{"active":true,"airMode":"audience","remaining":3,"airSource":"operator","held":false,"name":"heavy metal hits"}"""

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

        override suspend fun refreshRoles() = Unit
    }

    private fun repositories(scope: CoroutineScope): Pair<PlayoutRepository, OrderRepository> {
        val session = MutableStateFlow<SessionState>(SessionState.SignedIn("operator@example.com"))
        val playout =
            PlayoutRepository(
                session = session,
                readStatus = { throw IllegalStateException("not asked in this test") },
                readAir = { throw IllegalStateException("not asked in this test") },
                nowEpochMs = { 0L },
                scope = scope,
            )
        val order =
            OrderRepository(
                session = session,
                read = {
                    StationOrder(name = "Polled", mode = StationMode.ROTATION, onEnd = StationOnEnd.EXTEND, source = "director", items = emptyList())
                },
                nowEpochMs = { 0L },
                scope = scope,
            )
        return playout to order
    }

    private fun planned(brief: String, personaId: String? = null, eraFrom: String = "", callins: Boolean = false) =
        PlanUiState(
            scope = PlanScope.NEW,
            form = PlanForm(brief = brief, personaId = personaId, eraFrom = eraFrom, callins = callins),
            currentBrief = null,
            somethingOn = false,
        )
            .putOnAirInput()

    @Test
    fun `a broadcast planned from words sends only what was chosen`() = runTest {
        val recorded = Recorded()
        val (playout, order) = repositories(backgroundScope)
        val actions = AirActions(OperatorActions(FakeSession(recorded, HttpStatusCode.OK, airJson)), playout, order)

        assertTrue(actions.goOnAir(planned("heavy metal hits")))

        assertEquals("/api/director/air", recorded.path)
        // No host, no period, no phone-ins and no playlist: absent rather than null, which is what
        // the station reads as "leave my own answer standing".
        assertEquals("""{"name":"heavy metal hits","brief":"heavy metal hits","mode":"rotation","onEnd":"extend"}""", recorded.body)
    }

    @Test
    fun `what was chosen is carried, and nothing else is invented`() = runTest {
        val recorded = Recorded()
        val (playout, order) = repositories(backgroundScope)
        val actions = AirActions(OperatorActions(FakeSession(recorded, HttpStatusCode.OK, airJson)), playout, order)

        assertTrue(actions.goOnAir(planned("nineties", personaId = "p-2", eraFrom = "1990", callins = true)))

        val sent = recorded.body.orEmpty()
        assertTrue(sent, sent.contains(""""personaId":"p-2""""))
        assertTrue(sent, sent.contains(""""eraFrom":1990"""))
        assertTrue(sent, sent.contains(""""callins":true"""))
    }

    @Test
    fun `a station that refuses says so rather than looking as though it worked`() = runTest {
        val operator = OperatorActions(FakeSession(Recorded(), HttpStatusCode.UnprocessableEntity, "{}"))
        val (playout, order) = repositories(backgroundScope)
        val heard = mutableListOf<Notice>()
        backgroundScope.launch { operator.notices.collect { heard += it } }
        runCurrent()

        assertFalse(AirActions(operator, playout, order).goOnAir(planned("heavy metal hits")))
        runCurrent()

        assertEquals(listOf(Notice.Failed(422)), heard)
    }
}
