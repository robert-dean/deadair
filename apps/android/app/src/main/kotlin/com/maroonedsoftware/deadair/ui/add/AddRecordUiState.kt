package com.maroonedsoftware.deadair.ui.add

import com.maroonedsoftware.deadair.sdk.models.StationOrderItem
import com.maroonedsoftware.deadair.sdk.models.TrackRow
import com.maroonedsoftware.deadair.ui.order.RunningOrderUiState
import kotlin.uuid.ExperimentalUuidApi

/**
 * The fewest letters worth asking the station about, and how long the box must be still first.
 *
 * The console's own numbers (`jump.to.tsx`), so a phone and a desk put the same load on a station
 * that rate-limits: typing a title is one request rather than one per letter, and one letter
 * matches half the library.
 */
const val SEARCH_MIN_CHARS = 2
const val SEARCH_DEBOUNCE_MS = 250L

/**
 * What the box means as a query: trimmed, or `null` for nothing worth sending.
 *
 * `null` rather than an empty string because the station refuses an empty `search` outright
 * (`min=1`), which is a 400 for a box the listener has just cleared.
 */
fun searchTerm(typed: String): String? = typed.trim().takeIf { it.length >= SEARCH_MIN_CHARS }

/**
 * Where Play next puts a record: in front of the first item nobody has handed to the player, which
 * is the lowest position the station accepts. `null` when nothing is planned, which is the end, and
 * the end is then next.
 */
fun playNextIndex(items: List<StationOrderItem>): Int? = RunningOrderUiState(items).firstPlannedIndex.takeIf { it >= 0 }

/**
 * One search result as the list draws it.
 *
 * `addable` is whether the station holds the audio. It refuses a record it would have to fetch
 * first, so a row without it offers nothing rather than a button that could only ever be refused.
 * Having the audio does not promise the add lands: the station still applies its own rules.
 */
data class AddRow(val id: String, val title: String, val credit: String, val durationMs: Long?, val addable: Boolean) {
    companion object {
        @OptIn(ExperimentalUuidApi::class)
        fun of(row: TrackRow) = AddRow(id = row.id.toString(), title = row.title, credit = row.artists, durationMs = row.durationMs, addable = row.hasAudio)
    }
}
