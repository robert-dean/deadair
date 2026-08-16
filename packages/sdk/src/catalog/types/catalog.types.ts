import type { Pagination } from '../../shared/types/pagination.js';
import type { PaginationInput } from '../../shared/types/pagination.js';

/**
 * What the station has been told about a record. `neutral` is the absence of an opinion rather than
 * a middling one, and it is what rating something back to nothing means.
 * generated from [Rating](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L9)
 */
export type Rating = 'liked' | 'neutral' | 'disliked';

/**
 * One provider's copy of a record, with whatever the station holds of it.
 *
 * PER BINDING and never per track, which is the rule the whole page is built on: one canonical
 * record may bind to several copies inside one provider, those copies are different files with
 * different loudness and different cue points, and the one that airs is the one that was resolved.
 * Collapsing them would make "clear the audio" ambiguous about which file it took.
 *
 * The failure columns are here rather than hidden because that is the question this page exists to
 * answer. A row with `attempts` and no `fetchedAt` is a remembered failure, and `lastError` with
 * `nextAttemptAt` is the whole of why a perfectly good-looking record will not play.
 * generated from [TrackBinding](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L73)
 */
export interface TrackBinding {
    /** `track_sources.id`, which is also what the audio URL carries */
    sourceId: string;
    pluginId: string;
    externalId: string;
    /** False when the provider still knows the record but will not serve it here */
    playable: boolean;
    /** When the station gave up on this copy. Cleared by the next sync that sees it again */
    missingAt?: string;
    /** `sync` if a playlist walk saw it, `discovered` if something looked it up */
    origin: string;
    bitrate?: number;
    format?: string;
    lastSeenAt?: string;
    /** What the station holds of this copy, absent when nothing has ever fetched it. */
    byteSize?: number;
    fetchedAt?: string;
    lastServedAt?: string;
    /** CONSECUTIVE failures. Reset by a fetch that works */
    attempts: number;
    lastError?: string;
    nextAttemptAt?: string;
}

export interface TrackBindingInput {}

/**
 * What the measurement sidecar made of a record.
 *
 * `complete` is NOT `analyzedAt`, and the two are separate fields for a reason `0005_music.sql`
 * argues at length: a measurement of a truncated download is confident and wrong, so every reader in
 * the app filters on `complete` and a page that showed only a date would be reporting a record as
 * measured that nothing will use the measurement of.
 * generated from [TrackAnalysis](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L98)
 */
export interface TrackAnalysis {
    schemaVersion: number;
    complete: boolean;
    /** The measuring thing itself, which is not the plugin adapting it */
    analyzer?: string;
    analyzerPluginId?: string;
    analyzedAt?: string;
    failedAt?: string;
    failureReason?: string;
}

export interface TrackAnalysisInput {}

/**
 * One airing of a record, as this page needs it: when, and under which broadcast.
 * generated from [TrackPlay](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L109)
 */
export interface TrackPlay {
    airedAt: string;
    broadcastId?: string;
    /** What put it in the running order */
    source: string;
}

export interface TrackPlayInput {}

/**
 * Pagination plus a name filter. Every list operation here takes it, so the console's search box
 * narrows server-side rather than filtering one page client-side and lying about the total.
 * generated from [CatalogQuery](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L129)
 */
export interface CatalogQuery extends Pagination {
    search?: string;
}

export interface CatalogQueryInput extends PaginationInput {
    search?: string;
}

/**
 * generated from [EnrichmentExternalId](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L159)
 */
export interface EnrichmentExternalId {
    /** e.g. `musicbrainz`, `wikidata` */
    source: string;
    id: string;
}

/**
 * Narrowed to http(s) by the host before it is stored, since the console renders these as
 * something a human clicks.
 * generated from [EnrichmentLink](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L166)
 */
export interface EnrichmentLink {
    label: string;
    url: string;
}

/**
 * One thing the station believes, and the words it read that say so. Extracted by the host out of
 * an article a plugin handed over, rather than said by any plugin: `sourceUrl` is where a person
 * checks it and `sourceQuote` is the span that supports it, and neither is ever absent.
 * generated from [FactClaim](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L255)
 */
export interface FactClaim {
    id: string;
    /** One sentence, as the DJ would say it */
    claim: string;
    category: string;
    /** `lead` for the article's own opening, `model` for what a model found */
    source: string;
    sourceProvider: string;
    sourceUrl: string;
    sourceQuote: string;
    confidence?: number;
    model?: string;
    /** Absent means never said on air */
    lastUsedAt?: string;
}

export interface FactClaimInput {}

/**
 * Rate an artist, a record or a song. Ratings are absolute: a dislike anywhere above a track
 * excludes it, and nothing the station programmes may turn that off.
 * generated from [RateInput](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L13)
 */
export interface RateInput {
    rating: Rating;
}

/**
 * The canonical work, not a binding to a provider. `deadair.artists` minus the columns that
 * only ingest cares about: `artist_key` is a match key, and a row with `merged_into_id` set is
 * never read out at all.
 *
 * `imageUrl` on both contracts below is one field with two spellings. An absolute URL is the
 * provider's own, still hotlinked because nothing has cached it yet; a relative `art/<uuid>` is
 * the station's copy, to be resolved against the API base the client already configures (the API
 * mounts at the root and does not know the `/api` prefix the edge adds). Prefer the local one by
 * doing nothing: the switch happens server-side as soon as the art cache pass has the bytes.
 * generated from [Artist](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L26)
 */
export interface Artist {
    id: string;
    name: string;
    /** MusicBrainz artist id, absent until enrichment resolves one */
    mbid?: string;
    /** Absolute upstream URL, or an API-relative path to the local copy */
    imageUrl?: string;
    rating?: Rating;
    /** Unmerged albums credited to this artist */
    albumCount: number;
    /** Unmerged tracks credited to this artist */
    trackCount: number;
}

export interface ArtistInput {
    name: string;
    /** MusicBrainz artist id, absent until enrichment resolves one */
    mbid?: string;
    /** Absolute upstream URL, or an API-relative path to the local copy */
    imageUrl?: string;
    rating?: Rating;
}

/**
 * generated from [Album](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L36)
 */
export interface Album {
    id: string;
    name: string;
    artistId: string;
    /** Joined, so a list renders without a second request per row */
    artistName: string;
    /** MusicBrainz release-group id, absent until enrichment resolves one */
    mbid?: string;
    year?: number;
    /** Absolute upstream URL, or an API-relative path to the local copy */
    imageUrl?: string;
    rating?: Rating;
    trackCount: number;
}

export interface AlbumInput {
    name: string;
    /** MusicBrainz release-group id, absent until enrichment resolves one */
    mbid?: string;
    year?: number;
    /** Absolute upstream URL, or an API-relative path to the local copy */
    imageUrl?: string;
    rating?: Rating;
}

/**
 * generated from [Track](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L48)
 */
export interface Track {
    id: string;
    title: string;
    artistId: string;
    artistName: string;
    /** Absent on a single ingested outside any release: `tracks.album_id` is nullable */
    albumId?: string;
    albumName?: string;
    /** The record's cover, in the two spellings `Album.imageUrl` has. Nothing hangs art off a recording */
    albumImageUrl?: string;
    /** Display credit as written on the release ("X feat. Y"), not a join key */
    artists: string;
    genre?: string;
    year?: number;
    durationMs?: number;
    rating?: Rating;
}

export interface TrackInput {
    title: string;
    /** Display credit as written on the release ("X feat. Y"), not a join key */
    artists: string;
    genre?: string;
    year?: number;
    durationMs?: number;
    rating?: Rating;
}

/**
 * `releaseDate` is a string and not `datetime` because it is a partial date: MusicBrainz answers
 * `1997`, `1997-06` or `1997-06-24` depending on what is actually known about the release, and the
 * SDK types it the same way. A `datetime` would reject the first two or invent a day and a time
 * for them, which is a precision the source never claimed.
 * generated from [TrackEnrichmentData](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L175)
 */
export interface TrackEnrichmentData {
    artist?: string;
    title?: string;
    album?: string;
    year?: number;
    releaseDate?: string;
    genres?: string[];
    moods?: string[];
    biography?: string;
    /** Short lines, each independently speakable */
    facts?: string[];
    /** Not an integer: a tempo a source measured rather than declared is fractional */
    bpm?: number;
    musicalKey?: string;
    label?: string;
    isrc?: string;
    artworkUrl?: string;
    externalIds?: EnrichmentExternalId[];
    links?: EnrichmentLink[];
    /** What the plugin said that the SDK has no field for. Per provider only: the merged view drops it */
    extra?: Record<string, unknown>;
}

/**
 * generated from [ArtistEnrichmentData](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L195)
 */
export interface ArtistEnrichmentData {
    name?: string;
    biography?: string;
    imageUrl?: string;
    genres?: string[];
    facts?: string[];
    externalIds?: EnrichmentExternalId[];
    links?: EnrichmentLink[];
    extra?: Record<string, unknown>;
}

/**
 * generated from [AlbumEnrichmentData](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L206)
 */
export interface AlbumEnrichmentData {
    name?: string;
    /** The record's own credit, which is not always the track's */
    artist?: string;
    year?: number;
    /** Partial, exactly as on TrackEnrichmentData */
    releaseDate?: string;
    label?: string;
    genres?: string[];
    facts?: string[];
    artworkUrl?: string;
    externalIds?: EnrichmentExternalId[];
    links?: EnrichmentLink[];
    extra?: Record<string, unknown>;
}

/**
 * One page of artists, with the totals the request was counted against
 * generated from [ArtistPage](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L140)
 */
export interface ArtistPage {
    meta: Pagination;
    data: Artist[];
}

export interface ArtistPageInput {
    meta: PaginationInput;
    data: ArtistInput[];
}

/**
 * One page of albums
 * generated from [AlbumPage](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L145)
 */
export interface AlbumPage {
    meta: Pagination;
    data: Album[];
}

export interface AlbumPageInput {
    meta: PaginationInput;
    data: AlbumInput[];
}

/**
 * Everything one record has accumulated, in one read.
 *
 * The enrichment is deliberately NOT here. It has its own operation already, answering
 * `TrackEnrichmentDetail` with every provider's payload and the station's own sourced claims, and
 * the console draws it through the same panel the list uses. One enrichment shape rather than two.
 * generated from [TrackDetail](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L120)
 */
export interface TrackDetail extends Track {
    bindings: TrackBinding[];
    /** Absent for a record the walk has not reached */
    analysis?: TrackAnalysis;
    /** The most recent airings, newest first */
    plays: TrackPlay[];
    /** How many times in all, which the list above is only the head of */
    playCount: number;
}

export interface TrackDetailInput extends TrackInput {
    bindings: TrackBindingInput[];
    /** Absent for a record the walk has not reached */
    analysis?: TrackAnalysisInput;
    /** The most recent airings, newest first */
    plays: TrackPlayInput[];
}

/**
 * One page of tracks
 * generated from [TrackPage](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L150)
 */
export interface TrackPage {
    meta: Pagination;
    data: Track[];
}

export interface TrackPageInput {
    meta: PaginationInput;
    data: TrackInput[];
}

/**
 * One provider's stored answer. `found: false` is a recorded miss, which is a fact rather than a
 * failure: the provider was asked, had nothing, and is not asked again until `expiresAt`.
 * generated from [TrackEnrichmentSource](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L222)
 */
export interface TrackEnrichmentSource {
    provider: string;
    /** The id it was fetched under. Provenance, not identity */
    providerRef?: string;
    fetchedAt: string;
    expiresAt?: string;
    /** Past its TTL, so the next pass will ask again */
    stale: boolean;
    found: boolean;
    data: TrackEnrichmentData;
}

export interface TrackEnrichmentSourceInput {
    data: TrackEnrichmentData;
}

/**
 * generated from [ArtistEnrichmentSource](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L232)
 */
export interface ArtistEnrichmentSource {
    provider: string;
    providerRef?: string;
    fetchedAt: string;
    expiresAt?: string;
    stale: boolean;
    found: boolean;
    data: ArtistEnrichmentData;
}

export interface ArtistEnrichmentSourceInput {
    data: ArtistEnrichmentData;
}

/**
 * generated from [AlbumEnrichmentSource](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L242)
 */
export interface AlbumEnrichmentSource {
    provider: string;
    providerRef?: string;
    fetchedAt: string;
    expiresAt?: string;
    stale: boolean;
    found: boolean;
    data: AlbumEnrichmentData;
}

export interface AlbumEnrichmentSourceInput {
    data: AlbumEnrichmentData;
}

/**
 * Every provider's answer, plus the same merge the promotion step used, so the console and the
 * canonical columns cannot tell different stories. `sources` is empty on a row the walk has not
 * reached yet.
 *
 * `claims` sits beside them rather than inside `merged`, because a claim is the host's own and not
 * any provider's. The articles they were read out of are deliberately NOT here: raw source prose is
 * stored and never sent.
 * generated from [TrackEnrichmentDetail](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L275)
 */
export interface TrackEnrichmentDetail {
    trackId: string;
    merged: TrackEnrichmentData;
    sources: TrackEnrichmentSource[];
    claims: FactClaim[];
}

export interface TrackEnrichmentDetailInput {
    merged: TrackEnrichmentData;
    sources: TrackEnrichmentSourceInput[];
    claims: FactClaimInput[];
}

/**
 * generated from [ArtistEnrichmentDetail](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L282)
 */
export interface ArtistEnrichmentDetail {
    artistId: string;
    merged: ArtistEnrichmentData;
    sources: ArtistEnrichmentSource[];
    claims: FactClaim[];
}

export interface ArtistEnrichmentDetailInput {
    merged: ArtistEnrichmentData;
    sources: ArtistEnrichmentSourceInput[];
    claims: FactClaimInput[];
}

/**
 * generated from [AlbumEnrichmentDetail](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L289)
 */
export interface AlbumEnrichmentDetail {
    albumId: string;
    merged: AlbumEnrichmentData;
    sources: AlbumEnrichmentSource[];
    claims: FactClaim[];
}

export interface AlbumEnrichmentDetailInput {
    merged: AlbumEnrichmentData;
    sources: AlbumEnrichmentSourceInput[];
    claims: FactClaimInput[];
}
