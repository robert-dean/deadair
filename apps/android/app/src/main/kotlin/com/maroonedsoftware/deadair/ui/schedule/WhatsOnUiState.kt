package com.maroonedsoftware.deadair.ui.schedule

import com.maroonedsoftware.deadair.schedule.hoursOf
import com.maroonedsoftware.deadair.schedule.minutesBetween
import com.maroonedsoftware.deadair.schedule.spanOf
import com.maroonedsoftware.deadair.sdk.models.Persona
import com.maroonedsoftware.deadair.sdk.models.ScheduleNow
import com.maroonedsoftware.deadair.sdk.models.ScheduleOccurrence
import com.maroonedsoftware.deadair.sdk.models.ScheduleSlot
import com.maroonedsoftware.deadair.ui.text.Message

/** A block, as a card shows it. */
data class BlockCard(
    /** The station's own label, or `Untitled` for a slot that has none. */
    val label: Message,
    /** The block's hours, with the weekday when it is not the station's own today. Absent for a stamp that cannot be read. */
    val hours: Message.BlockHours?,
    val host: String?,
    val brief: String?,
)

/** The first cell: either the block on now, or the hours no block claims. */
sealed interface OnNow {
    data class Live(
        val block: BlockCard,
        /** `OnAir`, or `DueNow` while the station is doing something else. */
        val eyebrow: Message,
        val leftLabel: Message,
        val progress: Float,
        val takenOver: Boolean,
    ) : OnNow

    data class Between(val detail: Message) : OnNow
}

/** A block that has not started yet. */
data class Ahead(val eyebrow: Message, val startsIn: Message, val block: BlockCard)

data class WhatsOnUiState(val onNow: OnNow, val ahead: List<Ahead>)

/**
 * What is on, what is next, and what is after that.
 *
 * ## Every fact here comes from the station
 *
 * The blocks and the clock both arrive in one `GET /schedule/current`, and this phone does not know
 * the station's timezone and must not derive a station-local date. What is left for a client is one
 * subtraction between two readings taken in the same answer, which is exactly why `now` rides along
 * beside them.
 *
 * **There is deliberately no local timer.** The reading moves when the poll moves. A screen that
 * counted down between polls would be showing a second clock nobody asked about, and it would drift
 * away from the one the station is actually keeping.
 *
 * ## The block on now is not always the one airing
 *
 * An operator's own choice holds until the next slot BEGINS, so the schedule can want something the
 * station is not doing. That is said on the block it is about — the eyebrow reads "Due now" rather
 * than "On air" — because the alternative is telling a listener a show is on while they are plainly
 * hearing something else.
 *
 * Ported from the console's `on.now.strip.tsx`, which is the same three cells for the same reasons.
 * One thing differs on purpose: the host is named by their DJ name where they have one, because a
 * listener knows the voice rather than the persona the operator filed it under.
 */
fun whatsOn(current: ScheduleNow, slots: List<ScheduleSlot>, personas: List<Persona>): WhatsOnUiState {
    val blocks = current.upcoming

    // Covering `now` is what makes the first block the one ON now rather than the next one.
    // Comparing the stamps is the whole test: both are fixed-width readings of one clock, so there
    // is nothing to parse and nothing to get wrong.
    val first = blocks.firstOrNull()
    val live = if (first != null && first.start <= current.now) first else null
    val upcoming = if (live == null) blocks.take(2) else blocks.drop(1).take(2)

    // Absent counts, and is in fact the commonest form of it: a station put on by hand before there
    // was a schedule belongs to no slot at all.
    val takenOver = current.slotId != null && current.slotId != current.airingSlotId

    val onNow =
        if (live == null) {
            OnNow.Between(
                detail = if (first == null) Message.NoBlockDue else Message.SustainingFor(spanOf(minutesBetween(current.now, first.start))),
            )
        } else {
            val total = minutesBetween(live.start, live.end)
            val gone = minutesBetween(live.start, current.now)
            OnNow.Live(
                block = cardFor(live, current.now, slots, personas),
                eyebrow = if (takenOver) Message.DueNow else Message.OnAir,
                leftLabel = Message.Left(spanOf(total - gone)),
                // A block with no length cannot be part-way through one, so it reads as not started
                // rather than as finished: the bar is the honest shape of "nothing to report".
                progress = if (total <= 0) 0f else (gone.toFloat() / total.toFloat()).coerceIn(0f, 1f),
                takenOver = takenOver,
            )
        }

    return WhatsOnUiState(
        onNow = onNow,
        ahead =
            upcoming.mapIndexed { index, block ->
                Ahead(
                    eyebrow = if (index == 0) Message.UpNext else Message.AfterThat,
                    startsIn = Message.In(spanOf(minutesBetween(current.now, block.start))),
                    block = cardFor(block, current.now, slots, personas),
                )
            },
    )
}

private fun cardFor(block: ScheduleOccurrence, now: String, slots: List<ScheduleSlot>, personas: List<Persona>): BlockCard {
    val slot = slots.firstOrNull { it.id == block.slotId }
    val host = personas.firstOrNull { it.id == slot?.personaId }

    return BlockCard(
        // A slot may genuinely be unnamed, and an empty heading is worse than an honest placeholder.
        label = block.label.ifBlank { null }?.let(Message::Text) ?: Message.Untitled,
        hours = hoursOf(block.start, block.end, now),
        // The name they are introduced by, falling back to the one the operator filed them under.
        host = host?.let { it.djName?.takeIf(String::isNotBlank) ?: it.label },
        brief = slot?.brief?.takeIf(String::isNotBlank),
    )
}
