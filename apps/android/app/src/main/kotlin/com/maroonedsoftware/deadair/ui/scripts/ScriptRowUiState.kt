package com.maroonedsoftware.deadair.ui.scripts

import com.maroonedsoftware.deadair.sdk.models.ScriptAttempt
import com.maroonedsoftware.deadair.sdk.models.ScriptNeighbour
import com.maroonedsoftware.deadair.sdk.models.ScriptOutcome
import com.maroonedsoftware.deadair.sdk.models.ScriptRating
import com.maroonedsoftware.deadair.ui.text.Message

/**
 * How an attempt reads. A decline is standby rather than a fault, and that is the whole point of
 * the page: a model that declined and let the floor write is the registry working as designed.
 * Only a failed attempt, where something threw, is worth looking for.
 */
enum class ScriptTone { OK, STANDBY, FAULT }

/** A labelled fact in an attempt's detail. The value is the station's own word, shown as it came. */
data class Fact(val label: Message, val value: String)

/** One attempt, as its row draws it. Pure, so the JVM tests can read it. */
data class ScriptRowUiState(val attempt: ScriptAttempt) {
    val tone: ScriptTone
        get() =
            when (attempt.outcome) {
                ScriptOutcome.WRITTEN -> ScriptTone.OK
                ScriptOutcome.DECLINED -> ScriptTone.STANDBY
                ScriptOutcome.FAILED -> ScriptTone.FAULT
            }

    /** The words, or for an attempt that produced none, the reason, which takes the line the words would have. */
    val line: String get() = attempt.script ?: attempt.reason ?: ""

    /** Whether the line is the reason standing in for words, and is drawn dimmer for it. */
    val lineIsReason: Boolean get() = attempt.script == null

    /** A rating is asked for only where there are words to have an opinion about. */
    val rateable: Boolean get() = attempt.script != null

    /**
     * Absent stays absent, and is NOT neutral. Most attempts have never been read back, and drawing
     * them as deliberately-no-opinion would make an unreviewed history look like a reviewed one.
     */
    val rating: ScriptRating? get() = attempt.rating

    val writer: Message get() = Message.Writer(attempt.writer)

    /** Everything about the attempt that is not the sentence it produced, in the console's order. */
    val facts: List<Fact>
        get() =
            listOfNotNull(
                Fact(Message.FactKind, attempt.kind),
                attempt.personaKey?.let { Fact(Message.FactHost, it) },
                attempt.model?.let { Fact(Message.FactModel, it) },
                attempt.source?.let { Fact(Message.FactFrom, it) },
                attempt.durationMs?.let { Fact(Message.FactTook, "%.1f s".format(it / 1000.0)) },
                (attempt.usage?.totalTokens ?: attempt.usage?.outputTokens)?.let { Fact(Message.FactTokens, it.toString()) },
                attempt.previous?.let { Fact(Message.FactAfter, neighbour(it)) },
                attempt.next?.let { Fact(Message.FactBefore, neighbour(it)) },
                // Shown for a written attempt too: a model that produced words and a reason produced both.
                attempt.reason?.takeIf { attempt.script != null }?.let { Fact(Message.FactNote, it) },
            )

    private fun neighbour(track: ScriptNeighbour): String = "${track.title} — ${track.artist}"
}
