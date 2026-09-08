package com.maroonedsoftware.deadair.ui.catalog

import com.maroonedsoftware.deadair.sdk.models.EnrichmentLink
import com.maroonedsoftware.deadair.sdk.models.FactClaim
import com.maroonedsoftware.deadair.sdk.models.TrackEnrichmentData
import kotlin.time.Instant
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalUuidApi::class)
class EnrichmentUiStateTest {
    private val fetched = Instant.parse("2026-05-03T10:00:00Z")

    private fun provenance(found: Boolean = true, failed: Boolean = false, stale: Boolean = false) =
        Provenance(provider = "musicbrainz", fetchedAt = fetched, stale = stale, found = found, failed = failed)

    @Test
    fun `is empty only when nothing has been stored at all`() {
        assertTrue(EnrichmentUiState(EnrichmentFacts(), emptyList(), emptyList()).isEmpty)
        assertFalse(EnrichmentUiState(EnrichmentFacts(), listOf(provenance(found = false)), emptyList()).isEmpty)
    }

    @Test
    fun `tags are the genres then the moods`() {
        val ui = EnrichmentUiState(EnrichmentFacts.of(TrackEnrichmentData(genres = listOf("thrash"), moods = listOf("angry"))), emptyList(), emptyList())
        assertEquals(listOf("thrash", "angry"), ui.tags)
    }

    @Test
    fun `scalars drop what nobody resolved and keep the console's order`() {
        val ui =
            EnrichmentUiState(
                EnrichmentFacts.of(TrackEnrichmentData(year = 1990, label = " ", bpm = 140.0, musicalKey = "E minor", isrc = null)),
                emptyList(),
                emptyList(),
            )

        assertEquals(
            listOf(EnrichmentField.RELEASED to "1990", EnrichmentField.BPM to "140", EnrichmentField.KEY to "E minor"),
            ui.scalars,
        )
    }

    @Test
    fun `a full release date beats the year when it says more`() {
        val dated = EnrichmentUiState(EnrichmentFacts.of(TrackEnrichmentData(year = 1990, releaseDate = "1990-09-24")), emptyList(), emptyList())
        val yearOnly = EnrichmentUiState(EnrichmentFacts.of(TrackEnrichmentData(year = 1990, releaseDate = "1990")), emptyList(), emptyList())

        assertEquals("1990-09-24", dated.scalars.single().second)
        assertEquals("1990", yearOnly.scalars.single().second)
    }

    @Test
    fun `a fractional tempo keeps one decimal`() {
        val ui = EnrichmentUiState(EnrichmentFacts.of(TrackEnrichmentData(bpm = 127.5)), emptyList(), emptyList())
        assertEquals("127.5", ui.scalars.single().second)
    }

    @Test
    fun `a provider's row is one of four states, and failed-but-found is its own`() {
        assertEquals(SourceState.FOUND, provenance().state)
        assertEquals(SourceState.NOTHING_FOUND, provenance(found = false).state)
        assertEquals(SourceState.COULD_NOT_ASK, provenance(found = false, failed = true).state)
        assertEquals(SourceState.COULD_NOT_REASK, provenance(found = true, failed = true).state)
    }

    @Test
    fun `an artist's payload carries only what an artist has`() {
        val facts = EnrichmentFacts.of(com.maroonedsoftware.deadair.sdk.models.ArtistEnrichmentData(biography = "Formed in 1981.", links = listOf(EnrichmentLink("Wikipedia", "https://en.wikipedia.org/wiki/Metallica"))))
        assertEquals("Formed in 1981.", facts.biography)
        assertEquals(1, facts.links.size)
        assertTrue(EnrichmentUiState(facts, emptyList(), emptyList()).scalars.isEmpty())
    }

    @Test
    fun `claims are carried whole`() {
        val claim =
            FactClaim(
                id = Uuid.random(),
                claim = "The album was recorded in Copenhagen.",
                category = "recording_history",
                source = "model",
                sourceProvider = "wikipedia",
                sourceUrl = "https://en.wikipedia.org/wiki/Example",
                sourceQuote = "recorded at Sweet Silence Studios in Copenhagen",
            )
        assertEquals(listOf(claim), EnrichmentUiState(EnrichmentFacts(), emptyList(), listOf(claim)).claims)
    }
}
