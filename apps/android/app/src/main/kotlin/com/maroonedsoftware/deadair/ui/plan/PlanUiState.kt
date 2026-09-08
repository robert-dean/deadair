package com.maroonedsoftware.deadair.ui.plan

import com.maroonedsoftware.deadair.sdk.models.PutOnAirInput
import com.maroonedsoftware.deadair.sdk.models.ReplanStationInput
import com.maroonedsoftware.deadair.sdk.models.StationMode
import com.maroonedsoftware.deadair.sdk.models.StationOnEnd
import com.maroonedsoftware.deadair.ui.text.Message

/**
 * Whether this stays the same show.
 *
 * The one axis the two station commands differ on. `ReplanStationInput` is a strict subset of
 * `PutOnAirInput`, so the console found that making it two forms encoded the question as which of
 * two controls you clicked; it is asked outright instead, and the scope decides which fields EXIST
 * rather than which are greyed out.
 */
enum class PlanScope { KEEP, NEW }

/** What the operator has typed. Held as text where the field is text, so a half-typed year is representable. */
data class PlanForm(
    val brief: String = "",
    val personaId: String? = null,
    val eraFrom: String = "",
    val eraTo: String = "",
    val mode: StationMode = StationMode.ROTATION,
    val onEnd: StationOnEnd = StationOnEnd.EXTEND,
    val callins: Boolean = false,
)

/** What the station accepts, and what the console's own field allowed. */
const val BRIEF_MAX: Int = 500

/** The years a period may name. A record whose year the catalogue does not know plays whatever the period. */
val ERA_YEARS: IntRange = 1900..2100

/**
 * Planning the station: replan this show, or start a new one.
 *
 * Pure, because the interesting decisions are all about what to SEND. The one worth the most care
 * is the brief on a replan: absent keeps whatever the broadcast carries, an empty string CLEARS it,
 * and a string replaces it — three cases behind one text field, and the difference between the
 * first two is whether the operator touched the box.
 */
data class PlanUiState(
    val scope: PlanScope,
    val form: PlanForm,
    /** What the broadcast is already asked to play, which is what an unchanged field must not rewrite. */
    val currentBrief: String?,
    /** Whether there is a show to keep. Off air there is not, and the question is not a question. */
    val somethingOn: Boolean,
) {
    val showsScope: Boolean get() = somethingOn

    val keeping: Boolean get() = scope == PlanScope.KEEP && somethingOn

    /** Starting a new show over a running one is heard by everybody within a record, and says so. */
    val warnsReplacing: Boolean get() = !keeping && somethingOn

    /** A year still being typed: not an error to shout about, but not something to send either. */
    private val String.incompleteYear: Boolean get() = isNotBlank() && trim().length < YEAR_DIGITS

    private val String.year: Int? get() = trim().takeIf { it.length == YEAR_DIGITS }?.toIntOrNull()

    val fromYear: Int? get() = form.eraFrom.year

    val toYear: Int? get() = form.eraTo.year

    val eraFromError: Message? get() = fromYear?.takeIf { it !in ERA_YEARS }?.let { Message.EraOutOfRange }

    /**
     * The end of the period carries the backwards error as well as its own range.
     *
     * It is the field somebody typed second, so it is the one they meant to change — putting the
     * complaint on the start would send them back to a number they had already decided about.
     */
    val eraToError: Message?
        get() {
            val to = toYear
            val from = fromYear
            return when {
                to != null && to !in ERA_YEARS -> Message.EraOutOfRange
                from != null && to != null && from > to -> Message.EraBackwards
                else -> null
            }
        }

    private val eraReady: Boolean
        get() = eraFromError == null && eraToError == null && !form.eraFrom.incompleteYear && !form.eraTo.incompleteYear

    /**
     * Replanning is always allowed: asking the station to programme the same stretch again against
     * the same words is a real thing to want. Starting a show needs words, because they are what it
     * is programmed against and what it is called.
     */
    val canSubmit: Boolean get() = if (keeping) true else form.brief.isNotBlank() && eraReady

    /**
     * Absent keeps the brief, an empty string clears it, a string replaces it.
     *
     * Both sides are trimmed before they are compared, so a stored brief with a stray space is not
     * rewritten into itself by a field nobody touched. `count` is never sent: the station's own
     * answer of roughly an hour is what a phone means by a replan.
     */
    fun replanInput(): ReplanStationInput {
        val asked = form.brief.trim()
        return if (asked == currentBrief.orEmpty().trim()) ReplanStationInput() else ReplanStationInput(brief = asked)
    }

    /**
     * A new broadcast, built from words rather than from a playlist or a chart.
     *
     * The brief doubles as the name, because an operator who asked for heavy metal hits should read
     * that at the top of the tab rather than "The station". Everything optional is sent only when it
     * was chosen: an absent host is whichever persona the station has on air, an absent period is no
     * bound, and absent phone-ins leave the station's own setting standing.
     */
    fun putOnAirInput(): PutOnAirInput {
        val asked = form.brief.trim()
        return PutOnAirInput(
            name = asked,
            brief = asked,
            personaId = form.personaId,
            eraFrom = fromYear?.toLong(),
            eraTo = toYear?.toLong(),
            callins = true.takeIf { form.callins },
            mode = form.mode,
            onEnd = form.onEnd,
        )
    }

    private companion object {
        const val YEAR_DIGITS = 4
    }
}
