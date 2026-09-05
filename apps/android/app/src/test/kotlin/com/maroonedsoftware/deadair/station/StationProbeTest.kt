package com.maroonedsoftware.deadair.station

import com.maroonedsoftware.deadair.sdk.DeadairSdk
import com.maroonedsoftware.deadair.sdk.runtime.SdkConfig
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.respondError
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.http.HttpHeaders
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/**
 * Whether an address is a station, before the app agrees to remember it.
 *
 * The three outcomes are told apart on purpose. "Nothing answered" and "something answered and it
 * was not a station" are different mistakes — a wrong port versus a wrong host, say — and a
 * listener fixes them differently, so collapsing them into one message would cost them the clue.
 */
class StationProbeTest {
    private fun probeAgainst(engine: MockEngine) =
        StationProbe { station ->
            DeadairSdk(SdkConfig(baseUrl = station.apiBase, httpClient = HttpClient(engine)))
        }

    private val station = StationUrl.parse("https://radio.example.com").getOrThrow()

    @Test
    fun `names the station when the address answers`() = runTest {
        val engine =
            MockEngine {
                respond(
                    content = """{"station":"Static Between Stations","onAir":false,"listeners":0,"mounts":[]}""",
                    headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
                )
            }

        val result = probeAgainst(engine).check(station)

        assertEquals(StationCheck.Reachable("Static Between Stations"), result)
    }

    @Test
    fun `answers reachable for a quiet station, which is not a fault`() = runTest {
        // `/nowplaying` answers 200 with `onAir: false` rather than 404 precisely so a client does
        // not have to tell "off air" from "wrong address". This is that guarantee, from the
        // client's side.
        val engine =
            MockEngine {
                respond(
                    content = """{"station":"Static","onAir":false,"listeners":0,"mounts":[{"format":"mp3","path":"/live.mp3"}]}""",
                    headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
                )
            }

        assertTrue(probeAgainst(engine).check(station) is StationCheck.Reachable)
    }

    @Test
    fun `reports a status when something answers that is not a station`() = runTest {
        val engine = MockEngine { respondError(HttpStatusCode.NotFound) }

        assertEquals(StationCheck.NotAStation(404), probeAgainst(engine).check(station))
    }

    @Test
    fun `reports not-a-station when a 200 is not the shape`() = runTest {
        // A router's admin page, or somebody else's web server. It answers 200 and HTML, so only
        // the decode tells the difference.
        val engine =
            MockEngine {
                respond(content = "<html><body>hello</body></html>", headers = headersOf(HttpHeaders.ContentType, ContentType.Text.Html.toString()))
            }

        assertEquals(StationCheck.NotAStation(null), probeAgainst(engine).check(station))
    }

    @Test
    fun `reports unreachable when nothing answers at all`() = runTest {
        val engine = MockEngine { throw IOException("connection refused") }

        val result = probeAgainst(engine).check(station)

        assertTrue(result is StationCheck.Unreachable)
    }
}
