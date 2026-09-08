package com.maroonedsoftware.deadair.ui.scripts

import com.maroonedsoftware.deadair.sdk.models.ScriptAttempt
import com.maroonedsoftware.deadair.sdk.models.ScriptNeighbour
import com.maroonedsoftware.deadair.sdk.models.ScriptOutcome
import com.maroonedsoftware.deadair.sdk.models.ScriptRating
import com.maroonedsoftware.deadair.sdk.models.ScriptUsage
import com.maroonedsoftware.deadair.ui.text.Message
import kotlin.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScriptRowUiStateTest {
    private fun attempt(
        outcome: ScriptOutcome = ScriptOutcome.WRITTEN,
        script: String? = "Here is Metallica.",
        reason: String? = null,
        rating: ScriptRating? = null,
        writer: String = "model",
    ) = ScriptAttempt(id = "a", at = Instant.parse("2026-09-06T20:00:00Z"), kind = "link", writer = writer, outcome = outcome, script = script, reason = reason, rating = rating)

    @Test
    fun `a decline is standby, not a fault`() {
        assertEquals(ScriptTone.OK, ScriptRowUiState(attempt()).tone)
        assertEquals(ScriptTone.STANDBY, ScriptRowUiState(attempt(outcome = ScriptOutcome.DECLINED, script = null, reason = "nothing to say")).tone)
        assertEquals(ScriptTone.FAULT, ScriptRowUiState(attempt(outcome = ScriptOutcome.FAILED, script = null, reason = "timeout")).tone)
    }

    @Test
    fun `the reason takes the line when there are no words`() {
        val declined = ScriptRowUiState(attempt(outcome = ScriptOutcome.DECLINED, script = null, reason = "nothing to say"))
        assertEquals("nothing to say", declined.line)
        assertTrue(declined.lineIsReason)
        assertFalse(declined.rateable)

        val written = ScriptRowUiState(attempt())
        assertEquals("Here is Metallica.", written.line)
        assertFalse(written.lineIsReason)
        assertTrue(written.rateable)
    }

    @Test
    fun `an absent rating stays absent rather than becoming neutral`() {
        assertNull(ScriptRowUiState(attempt()).rating)
        assertEquals(ScriptRating.NEUTRAL, ScriptRowUiState(attempt(rating = ScriptRating.NEUTRAL)).rating)
    }

    @Test
    fun `names the writer for the resolver to translate`() {
        assertEquals(Message.Writer("deterministic"), ScriptRowUiState(attempt(writer = "deterministic")).writer)
    }

    @Test
    fun `the facts follow the console's order and drop what is absent`() {
        val full =
            attempt(reason = "kept it short").copy(
                personaKey = "cass",
                model = "gpt",
                durationMs = 1_250,
                usage = ScriptUsage(outputTokens = 40, totalTokens = 120),
                previous = ScriptNeighbour(title = "One", artist = "A"),
                next = ScriptNeighbour(title = "Two", artist = "B"),
            )
        val facts = ScriptRowUiState(full).facts

        assertEquals(
            listOf(Message.FactKind, Message.FactHost, Message.FactModel, Message.FactTook, Message.FactTokens, Message.FactAfter, Message.FactBefore, Message.FactNote),
            facts.map { it.label },
        )
        assertEquals("1.3 s", facts.first { it.label == Message.FactTook }.value)
        assertEquals("120", facts.first { it.label == Message.FactTokens }.value)
        assertEquals("One — A", facts.first { it.label == Message.FactAfter }.value)
    }

    @Test
    fun `a reason on an attempt with no words is the line, not a note`() {
        val facts = ScriptRowUiState(attempt(outcome = ScriptOutcome.DECLINED, script = null, reason = "nothing to say")).facts
        assertEquals(listOf(Message.FactKind), facts.map { it.label })
    }
}
