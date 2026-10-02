package com.maroonedsoftware.deadair.scripts

import com.maroonedsoftware.deadair.sdk.models.ScriptAttempt
import com.maroonedsoftware.deadair.sdk.models.ScriptOutcome
import com.maroonedsoftware.deadair.ui.text.Message
import kotlin.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BreakShareTest {
    private fun attempt(outcome: ScriptOutcome = ScriptOutcome.WRITTEN, segmentId: String? = "11111111-1111-4111-8111-111111111111") =
        ScriptAttempt(id = "a", at = Instant.parse("2026-10-01T20:00:00Z"), kind = "talkbreak", writer = "model", outcome = outcome, script = "Here is Metallica.", segmentId = segmentId)

    @Test
    fun `only a written break whose segment is still known can be shared`() {
        assertTrue(BreakShare.shareable(attempt()))
        assertFalse(BreakShare.shareable(attempt(segmentId = null)))
        assertFalse(BreakShare.shareable(attempt(outcome = ScriptOutcome.DECLINED)))
        assertFalse(BreakShare.shareable(attempt(outcome = ScriptOutcome.FAILED)))
    }

    @Test
    fun `the file takes the name the station offered`() {
        assertEquals("deadair-top-of-the-hour.m4a", BreakShare.fileName("""attachment; filename="deadair-top-of-the-hour.m4a"""", "m4a"))
    }

    @Test
    fun `a name that would escape the cache directory is cleaned rather than trusted`() {
        assertEquals("deadair-sneaky.m4a", BreakShare.fileName("""attachment; filename="../../deadair-sneaky.m4a"""", "m4a"))
    }

    @Test
    fun `with no name offered, or nothing usable, the copy gets one of its own`() {
        assertEquals(BreakShare.FALLBACK_NAME, BreakShare.fileName(null, "m4a"))
        assertEquals(BreakShare.FALLBACK_NAME, BreakShare.fileName("attachment", "m4a"))
        assertEquals(BreakShare.FALLBACK_NAME, BreakShare.fileName("""attachment; filename="///"""", "m4a"))
    }

    // An older station ignores the rendition and sends the original. Shared as what it is, the name
    // follows the type rather than claiming an .m4a it is not.
    @Test
    fun `the extension follows the type the station actually sent`() {
        assertEquals("deadair-break.wav", BreakShare.fileName(null, "wav"))
    }

    @Test
    fun `each way of not getting a copy says something different`() {
        assertEquals(Message.ShareCouldNotReach, BreakShare.failure(null))
        assertEquals(Message.ShareGone, BreakShare.failure(404))
        assertEquals(Message.ShareCannotCopy, BreakShare.failure(503))
        assertEquals(Message.ShareFailed, BreakShare.failure(502))
    }
}
