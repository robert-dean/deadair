package com.maroonedsoftware.deadair.ui.add

import com.maroonedsoftware.deadair.sdk.models.StationItemState
import com.maroonedsoftware.deadair.sdk.models.StationOrderItem
import com.maroonedsoftware.deadair.sdk.models.StationOrderItemKind
import com.maroonedsoftware.deadair.sdk.models.TrackRow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/**
 * The library search's rules, which are the station's rules restated.
 *
 * A blank search is a 400 rather than "everything", and a Play next below the committed head is a
 * 422 rather than clamped, so both are decided here, where a test can see them, instead of being
 * found by an operator watching a request fail.
 */
@OptIn(ExperimentalUuidApi::class)
class AddRecordUiStateTest {
    private fun item(id: String, state: StationItemState) =
        StationOrderItem(id = id, kind = StationOrderItemKind.TRACK, state = state, title = id, artists = emptyList())

    private fun row(hasAudio: Boolean) =
        TrackRow(
            id = Uuid.parse("5b0e8a52-3c1f-4d2a-9e7b-0f6c1d2e3a4b"),
            title = "Song",
            artistId = Uuid.parse("0c9f3e1a-7b2d-4e8f-a1c3-5d6e7f809a1b"),
            artistName = "Band",
            artists = "Band feat. Guest",
            durationMs = 200_000L,
            hasAudio = hasAudio,
            measured = true,
            enriched = false,
        )

    @Test
    fun `a box with nothing worth asking about is not a query`() {
        assertNull(searchTerm(""))
        assertNull(searchTerm("   "))
        assertNull(searchTerm("a"))
        assertNull(searchTerm(" a "))
    }

    @Test
    fun `a term is sent trimmed`() {
        assertEquals("ab", searchTerm("ab"))
        assertEquals("love will", searchTerm("  love will "))
    }

    @Test
    fun `play next goes in front of the first record nobody has handed to the player`() {
        val items =
            listOf(
                item("played", StationItemState.PLAYED),
                item("airing", StationItemState.AIRING),
                item("handed", StationItemState.HANDED),
                item("next", StationItemState.PLANNED),
                item("later", StationItemState.PLANNED),
            )

        assertEquals(3, playNextIndex(items))
    }

    @Test
    fun `with nothing planned the end is next, which is no position at all`() {
        assertNull(playNextIndex(listOf(item("airing", StationItemState.AIRING))))
        assertNull(playNextIndex(emptyList()))
    }

    @Test
    fun `a record the station has no audio for offers nothing`() {
        assertTrue(AddRow.of(row(hasAudio = true)).addable)
        assertFalse(AddRow.of(row(hasAudio = false)).addable)
    }

    @Test
    fun `a row carries the credit as the release writes it`() {
        val shown = AddRow.of(row(hasAudio = true))

        assertEquals("5b0e8a52-3c1f-4d2a-9e7b-0f6c1d2e3a4b", shown.id)
        assertEquals("Band feat. Guest", shown.credit)
        assertEquals(200_000L, shown.durationMs)
    }
}
