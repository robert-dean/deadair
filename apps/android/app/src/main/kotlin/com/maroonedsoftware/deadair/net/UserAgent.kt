package com.maroonedsoftware.deadair.net

import com.maroonedsoftware.deadair.BuildConfig
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response

/**
 * The one User-Agent, put on every request by the client rather than by each caller.
 *
 * HLS listeners are counted per IP and agent, so a phone that sends two agents is two listeners
 * and one that sends none is whatever OkHttp's default happens to be that version. Before this the
 * SDK merged the header into its own requests and the image loader sent `okhttp/4.x`, which was the
 * second listener. An interceptor on the shared client cannot be forgotten by a new caller.
 */
object UserAgent : Interceptor {
    /**
     * Named after the app and its version, so a station's logs can tell this client apart.
     *
     * The version is `versionName` from the build rather than written here a second time, because
     * the copy here would stay behind the first time the real one moved, and every phone would go on
     * telling the station it was 0.1.0.
     */
    const val VALUE: String = "deadair-android/" + BuildConfig.VERSION_NAME

    private const val HEADER = "User-Agent"

    override fun intercept(chain: Interceptor.Chain): Response = chain.proceed(withUserAgent(chain.request()))

    /**
     * The request, wearing the app's agent.
     *
     * Overwritten rather than filled in when absent, because the whole point is that there is one:
     * a caller that set its own would have re-created the second listener this exists to remove.
     */
    fun withUserAgent(request: Request): Request = request.newBuilder().header(HEADER, VALUE).build()
}
