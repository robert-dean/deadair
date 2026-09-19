package com.maroonedsoftware.deadair.catalog

import com.maroonedsoftware.deadair.auth.Notice
import com.maroonedsoftware.deadair.auth.OperatorActions
import com.maroonedsoftware.deadair.auth.OperatorSession
import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.director.OrderRepository
import com.maroonedsoftware.deadair.sdk.DeadairSdk
import com.maroonedsoftware.deadair.sdk.models.Rating
import com.maroonedsoftware.deadair.sdk.models.StationMode
import com.maroonedsoftware.deadair.sdk.models.StationOnEnd
import com.maroonedsoftware.deadair.sdk.models.StationOrder
import com.maroonedsoftware.deadair.sdk.runtime.SdkConfig
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockEngineConfig
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The operator's marks on the library.
 *
 * The asymmetry is the thing worth pinning: a TRACK's rating is carried on the running order's rows,
 * so rating one asks the order to read again at once, and an album's or an artist's is not, so
 * rating those must not cost a read. Whoever tidies the three into one helper would otherwise make
 * them all alike, in whichever direction came first.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CatalogActionsTest {
    private val trackId = "5b0e8a52-3c1f-4d2a-9e7b-0f6c1d2e3a4b"

    private val trackJson = """{"id":"$trackId","title":"Song","artistId":"$trackId","artistName":"Band","artists":"Band","rating":"liked"}"""
    private val albumJson = """{"id":"$trackId","name":"Record","artistId":"$trackId","artistName":"Band","trackCount":10}"""
    private val artistJson = """{"id":"$trackId","name":"Band","albumCount":2,"trackCount":20}"""

    private class Recorded {
        var path: String? = null
        var body: String? = null
        var requests = 0
    }

    /**
     * The engine answers on the test's own dispatcher when given one. Left on its default IO thread, a
     * request is a wait `runTest` cannot see into, so it skips virtual time ahead through the order's
     * five-second poll and the read count means nothing.
     */
    private class FakeSession(private val recorded: Recorded, status: HttpStatusCode, body: String, dispatcher: CoroutineDispatcher? = null) : OperatorSession {
        var refreshes = 0
        private val sdk =
            DeadairSdk(
                SdkConfig(
                    baseUrl = "https://radio.example/api",
                    httpClient =
                        HttpClient(
                            MockEngine(
                                MockEngineConfig().apply {
                                    dispatcher?.let { this.dispatcher = it }
                                    addHandler { request ->
                                        recorded.requests += 1
                                        recorded.path = request.url.encodedPath
                                        recorded.body = (request.body as? TextContent)?.text
                                        respond(content = body, status = status, headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()))
                                    }
                                },
                            ),
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
                StationOrder(name = "Polled", mode = StationMode.ROTATION, onEnd = StationOnEnd.EXTEND, source = "director", items = emptyList())
            },
            nowEpochMs = { 0L },
            scope = scope,
        )

    /** A repository with the Up next tab subscribed, so a kick is a read; answers the running count. */
    private fun TestScope.watchedRepository(): Pair<OrderRepository, () -> Int> {
        var reads = 0
        val order = repositoryFor(backgroundScope) { reads += 1 }
        backgroundScope.launch { order.state.collect {} }
        runCurrent()
        return order to { reads }
    }

    @Test
    fun `rating a track puts the mark on the wire`() = runTest {
        val recorded = Recorded()
        val actions = CatalogActions(OperatorActions(FakeSession(recorded, HttpStatusCode.OK, trackJson)), repositoryFor(backgroundScope))

        assertTrue(actions.rateTrack(trackId, Rating.LIKED))

        assertEquals("/api/catalog/tracks/$trackId/rating", recorded.path)
        assertEquals("""{"rating":"liked"}""", recorded.body)
    }

    @Test
    fun `rating a track reads the running order again at once`() = runTest {
        val (order, reads) = watchedRepository()
        val actions = CatalogActions(OperatorActions(FakeSession(Recorded(), HttpStatusCode.OK, trackJson, StandardTestDispatcher(testScheduler))), order)
        assertEquals(1, reads())

        assertTrue(actions.rateTrack(trackId, Rating.DISLIKED))
        runCurrent()

        assertEquals(2, reads())
    }

    @Test
    fun `rating an album or an artist does not read the running order`() = runTest {
        val (order, reads) = watchedRepository()

        assertTrue(CatalogActions(OperatorActions(FakeSession(Recorded(), HttpStatusCode.OK, albumJson, StandardTestDispatcher(testScheduler))), order).rateAlbum(trackId, Rating.LIKED))
        assertTrue(CatalogActions(OperatorActions(FakeSession(Recorded(), HttpStatusCode.OK, artistJson, StandardTestDispatcher(testScheduler))), order).rateArtist(trackId, Rating.LIKED))
        runCurrent()

        assertEquals(1, reads())
    }

    @Test
    fun `album and artist marks go to their own addresses`() = runTest {
        val album = Recorded()
        val artist = Recorded()

        CatalogActions(OperatorActions(FakeSession(album, HttpStatusCode.OK, albumJson)), repositoryFor(backgroundScope)).rateAlbum(trackId, Rating.NEUTRAL)
        CatalogActions(OperatorActions(FakeSession(artist, HttpStatusCode.OK, artistJson)), repositoryFor(backgroundScope)).rateArtist(trackId, Rating.DISLIKED)

        assertEquals("/api/catalog/albums/$trackId/rating", album.path)
        assertEquals("""{"rating":"neutral"}""", album.body)
        assertEquals("/api/catalog/artists/$trackId/rating", artist.path)
        assertEquals("""{"rating":"disliked"}""", artist.body)
    }

    @Test
    fun `a refused mark re-reads the roles, says so, and does not read the order`() = runTest {
        val (order, reads) = watchedRepository()
        val fake = FakeSession(Recorded(), HttpStatusCode.Forbidden, "{}", StandardTestDispatcher(testScheduler))
        val operator = OperatorActions(fake)
        val heard = mutableListOf<Notice>()
        backgroundScope.launch { operator.notices.collect { heard += it } }
        runCurrent()

        assertFalse(CatalogActions(operator, order).rateTrack(trackId, Rating.LIKED))
        runCurrent()

        assertEquals(1, fake.refreshes)
        assertEquals(listOf(Notice.NoLongerOperator), heard)
        assertEquals(1, reads())
    }

    @Test
    fun `an id that is not one never reaches the station`() = runTest {
        val recorded = Recorded()
        val operator = OperatorActions(FakeSession(recorded, HttpStatusCode.OK, trackJson))
        val heard = mutableListOf<Notice>()
        backgroundScope.launch { operator.notices.collect { heard += it } }
        runCurrent()

        assertFalse(CatalogActions(operator, repositoryFor(backgroundScope)).rateTrack("not-a-uuid", Rating.LIKED))
        runCurrent()

        assertEquals(0, recorded.requests)
        assertNull(recorded.path)
        assertEquals(listOf(Notice.CouldNotReach), heard)
    }
}
