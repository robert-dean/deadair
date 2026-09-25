package com.maroonedsoftware.deadair.station

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** What a scanned code is taken to name. The console's code first, because it is the one that matters. */
class ScannedCodeTest {
    @Test
    fun `the console's code names its station, plain http included`() {
        assertEquals("http://192.168.1.20:8080", ScannedCode.station("deadair://connect?station=http%3A%2F%2F192.168.1.20%3A8080")?.origin)
    }

    @Test
    fun `a plain https address is taken`() {
        assertEquals("https://radio.example.com", ScannedCode.station("https://radio.example.com")?.origin)
    }

    @Test
    fun `whitespace around the code is not part of it`() {
        assertEquals("https://radio.example.com", ScannedCode.station("  https://radio.example.com\n")?.origin)
    }

    @Test
    fun `a Wi-Fi code is refused rather than read as a host`() {
        assertNull(ScannedCode.station("WIFI:S:home;T:WPA;P:secret;;"))
    }

    @Test
    fun `a bare word is refused, although typing it would be read as a host`() {
        assertNull(ScannedCode.station("menu"))
    }

    @Test
    fun `an address carrying a user and password is refused`() {
        assertNull(ScannedCode.station("https://admin:hunter2@radio.example.com"))
    }

    @Test
    fun `a link carrying a user is refused`() {
        assertNull(ScannedCode.station("deadair://connect?station=https%3A%2F%2Fadmin%40radio.example.com"))
    }
}
