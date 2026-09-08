package com.maroonedsoftware.deadair.ui.catalog

import com.maroonedsoftware.deadair.sdk.models.AlbumEnrichmentData
import com.maroonedsoftware.deadair.sdk.models.AlbumEnrichmentSource
import com.maroonedsoftware.deadair.sdk.models.ArtistEnrichmentData
import com.maroonedsoftware.deadair.sdk.models.ArtistEnrichmentSource
import com.maroonedsoftware.deadair.sdk.models.EnrichmentLink
import com.maroonedsoftware.deadair.sdk.models.FactClaim
import com.maroonedsoftware.deadair.sdk.models.TrackEnrichmentData
import com.maroonedsoftware.deadair.sdk.models.TrackEnrichmentSource
import kotlin.time.Instant

/**
 * The union of the three enrichment payloads: an artist has no tempo, an album has no ISRC, and
 * every field on all three is optional anyway. One shape rather than three, so one panel serves
 * every page and cannot drift between them.
 */
data class EnrichmentFacts(
    val year: Long? = null,
    val releaseDate: String? = null,
    val label: String? = null,
    val bpm: Double? = null,
    val musicalKey: String? = null,
    val isrc: String? = null,
    val biography: String? = null,
    val genres: List<String> = emptyList(),
    val moods: List<String> = emptyList(),
    val facts: List<String> = emptyList(),
    val links: List<EnrichmentLink> = emptyList(),
) {
    companion object {
        fun of(data: TrackEnrichmentData) =
            EnrichmentFacts(
                year = data.year,
                releaseDate = data.releaseDate,
                label = data.label,
                bpm = data.bpm,
                musicalKey = data.musicalKey,
                isrc = data.isrc,
                biography = data.biography,
                genres = data.genres.orEmpty(),
                moods = data.moods.orEmpty(),
                facts = data.facts.orEmpty(),
                links = data.links.orEmpty(),
            )

        fun of(data: AlbumEnrichmentData) =
            EnrichmentFacts(
                year = data.year,
                releaseDate = data.releaseDate,
                label = data.label,
                genres = data.genres.orEmpty(),
                facts = data.facts.orEmpty(),
                links = data.links.orEmpty(),
            )

        fun of(data: ArtistEnrichmentData) =
            EnrichmentFacts(
                biography = data.biography,
                genres = data.genres.orEmpty(),
                facts = data.facts.orEmpty(),
                links = data.links.orEmpty(),
            )
    }
}

/** One provider's row, without the payload: who answered, when, and whether they had anything. */
data class Provenance(val provider: String, val fetchedAt: Instant, val stale: Boolean, val found: Boolean, val failed: Boolean) {
    /**
     * Three states rather than two. A source that answered with nothing and one that could not be
     * reached are opposite facts: the first is settled and the second is the walk still owing an
     * answer. A source can be both found and failed: what it said in May is still the best answer
     * there is, and it could not be re-asked today.
     */
    val state: SourceState
        get() =
            when {
                failed && found -> SourceState.COULD_NOT_REASK
                failed -> SourceState.COULD_NOT_ASK
                found -> SourceState.FOUND
                else -> SourceState.NOTHING_FOUND
            }

    companion object {
        fun of(source: TrackEnrichmentSource) = Provenance(source.provider, source.fetchedAt, source.stale, source.found, source.failed)

        fun of(source: AlbumEnrichmentSource) = Provenance(source.provider, source.fetchedAt, source.stale, source.found, source.failed)

        fun of(source: ArtistEnrichmentSource) = Provenance(source.provider, source.fetchedAt, source.stale, source.found, source.failed)
    }
}

enum class SourceState { FOUND, NOTHING_FOUND, COULD_NOT_ASK, COULD_NOT_REASK }

/** The scalar fields, in the order they are worth reading. */
enum class EnrichmentField { RELEASED, LABEL, BPM, KEY, ISRC }

/**
 * What the providers said about one artist, record or recording, as the panel lays it out.
 *
 * The provenance is not decoration: everything above it is a claim by some upstream, and somebody
 * looking at a wrong genre needs to know which source to go and correct and how old the answer is.
 */
data class EnrichmentUiState(val facts: EnrichmentFacts, val sources: List<Provenance>, val claims: List<FactClaim>) {
    /** Nothing has been stored for this row at all: no provider asked, no claim extracted. */
    val isEmpty: Boolean get() = sources.isEmpty() && claims.isEmpty()

    val tags: List<String> get() = facts.genres + facts.moods

    /**
     * The scalars, dropping the ones nobody resolved. The release date is preferred over the year
     * when it says more than the year alone does; it is labelled as the providers' claim because a
     * track page also shows the year off the file itself, and the two disagree often enough.
     */
    val scalars: List<Pair<EnrichmentField, String>>
        get() =
            listOfNotNull(
                (facts.releaseDate?.takeIf { it.length > 4 } ?: facts.year?.toString())?.let { EnrichmentField.RELEASED to it },
                facts.label?.takeIf { it.isNotBlank() }?.let { EnrichmentField.LABEL to it },
                facts.bpm?.let { EnrichmentField.BPM to formatBpm(it) },
                facts.musicalKey?.takeIf { it.isNotBlank() }?.let { EnrichmentField.KEY to it },
                facts.isrc?.takeIf { it.isNotBlank() }?.let { EnrichmentField.ISRC to it },
            )

    private fun formatBpm(bpm: Double): String = if (bpm == Math.floor(bpm)) bpm.toLong().toString() else "%.1f".format(bpm)
}
