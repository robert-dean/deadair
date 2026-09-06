package com.maroonedsoftware.deadair.net

import com.maroonedsoftware.deadair.sdk.DeadairSdk
import com.maroonedsoftware.deadair.sdk.runtime.SdkConfig
import com.maroonedsoftware.deadair.station.StationUrl
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import okhttp3.OkHttpClient

/**
 * One HTTP stack for the whole app.
 *
 * The generated SDK declares no Ktor engine — `HttpClient()` finds whatever is on the classpath —
 * so choosing one is this app's job, and OkHttp is the choice because the image loader uses it
 * too. That is not tidiness: HLS listeners are counted per IP AND User-Agent inside a 15-second
 * window, so every request this app makes carrying the same agent is what keeps one listener from
 * being counted as several, or as none.
 *
 * ExoPlayer keeps its own `DefaultHttpDataSource` rather than joining this, because that one sends
 * `Icy-MetaData: 1` and parses the ICY stream itself. It is given the same agent string.
 */
object HttpClients {
    /** Named after the app and its version, so a station's logs can tell this client apart. */
    const val USER_AGENT: String = "deadair-android/0.1.0"

    val okHttp: OkHttpClient by lazy { OkHttpClient.Builder().build() }

    val ktor: HttpClient by lazy {
        HttpClient(OkHttp) {
            engine { preconfigured = okHttp }
            install(HttpTimeout) {
                requestTimeoutMillis = REQUEST_TIMEOUT_MS
                connectTimeoutMillis = CONNECT_TIMEOUT_MS
            }
        }
    }

    /**
     * An SDK pointed at one station.
     *
     * Cheap to build — it wraps the shared client rather than creating one — and because the SDK
     * never closes a client it was handed, these can be made per station without leaking a
     * connection pool.
     *
     * `headers` is the caller's chance to add to the one header this always sends, and it is a
     * `suspend` lambda because the SDK calls it once per REQUEST rather than once per client. That
     * is what lets a session attach a bearer that changes underneath a client already in use, and
     * it is why nothing has to rebuild an SDK to refresh a token. The agent is merged in here
     * rather than left to callers: an anonymous poll and a signed-in read have to look like one
     * listener to a station counting them, and forgetting it in one place would make them two.
     */
    fun sdkFor(station: StationUrl, headers: suspend () -> Map<String, String> = { emptyMap() }): DeadairSdk =
        DeadairSdk(
            SdkConfig(
                baseUrl = station.apiBase,
                headers = { mapOf("User-Agent" to USER_AGENT) + headers() },
                httpClient = ktor,
            ),
        )

    /**
     * Short, because every use of this is something a person is waiting on: the setup screen's
     * check, and a poll whose whole point is to be current. A slow answer is a failed one here.
     */
    private const val REQUEST_TIMEOUT_MS = 5_000L
    private const val CONNECT_TIMEOUT_MS = 5_000L
}
