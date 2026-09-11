package com.maroonedsoftware.deadair.net

import com.maroonedsoftware.deadair.BuildConfig
import okhttp3.Request
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class UserAgentTest {
    @Test
    fun `names the app and the version it was built as`() {
        assertTrue(BuildConfig.VERSION_NAME.isNotBlank())
        assertTrue(UserAgent.VALUE.startsWith("deadair-android/"))
        assertTrue(UserAgent.VALUE.endsWith(BuildConfig.VERSION_NAME))
    }

    @Test
    fun `puts the app's agent on a request that had none`() {
        val sent = UserAgent.withUserAgent(Request.Builder().url("https://radio.example/api/art/1").build())

        assertEquals(UserAgent.VALUE, sent.header("User-Agent"))
    }

    @Test
    fun `replaces an agent a caller set, so there is only ever one`() {
        val sent = UserAgent.withUserAgent(Request.Builder().url("https://radio.example/").header("User-Agent", "okhttp/4.12").build())

        assertEquals(listOf(UserAgent.VALUE), sent.headers("User-Agent"))
    }

    @Test
    fun `leaves everything else about the request alone`() {
        val sent = UserAgent.withUserAgent(Request.Builder().url("https://radio.example/api/nowplaying").header("Authorization", "Bearer t").build())

        assertEquals("Bearer t", sent.header("Authorization"))
        assertEquals("https://radio.example/api/nowplaying", sent.url.toString())
    }
}
