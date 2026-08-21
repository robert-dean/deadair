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
 * What a clear actually did.
 *
 * A count rather than a bare 204, because the interesting answers are the small ones: clearing the
 * audio of a record with three copies and being told `1` is the station saying two of them were
 * never here — which is a fact about the record and not about the button.
 * generated from [TrackClearResult](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L132)
 */
export interface TrackClearResult {
    trackId: string;
    /** Rows this affected. Zero is an ordinary answer, not a failure */
    cleared: number;
    /** What happened, in the words the console shows */
    detail: string;
}

export interface TrackClearResultInput {}

/**
 * Narrow a clear to one provider's answer, for the case where one source is wrong and the rest are
 * not. Absent clears every provider's.
 * generated from [ClearEnrichmentQuery](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L140)
 */
export interface ClearEnrichmentQuery {
    provider?: string;
}

/**
 * Pagination plus a name filter. Every list operation here takes it, so the console's search box
 * narrows server-side rather than filtering one page client-side and lying about the total.
 * generated from [CatalogQuery](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L146)
 */
export interface CatalogQuery extends Pagination {
    search?: string;
}

export interface CatalogQueryInput extends PaginationInput {
    search?: string;
}

/**
 * Which records to show, by what the station has of them rather than by what they are.
 *
 *   cached      the audio is on this machine, so it can be committed to the running order now
 *   uncached    it is not, which for most of a library is ordinary rather than wrong
 *   unmeasured  no trustworthy measurement, so no cue points and no level decided before air
 *   benched     every copy written off, which is the one state that means it CANNOT air
 *   failing     a fetch has failed and is backing off. Not benched yet, and often the state before it
 * generated from [TrackState](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L157)
 */
export type TrackState = 'cached' | 'uncached' | 'unmeasured' | 'benched' | 'failing';

/**
 * How much of the library is in each state, over the whole filtered set rather than this page.
 *
 * The aggregate is what an operator reads first — "13 of 581 measured" is the sentence that made
 * `docs/todo/analysis-queue-ordering.md` necessary, and it was a psql query then. `total` is the
 * same number as `meta.total` when nothing is filtered, and is repeated here so the counts can be
 * read as N of M without reaching into the pager.
 * generated from [TrackStateCounts](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L173)
 */
export interface TrackStateCounts {
    total: number;
    cached: number;
    measured: number;
    enriched: number;
    benched: number;
    failing: number;
}

export interface TrackStateCountsInput {}

/**
 * generated from [EnrichmentExternalId](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L221)
 */
export interface EnrichmentExternalId {
    /** e.g. `musicbrainz`, `wikidata` */
    source: string;
    id: string;
}

/**
 * Narrowed to http(s) by the host before it is stored, since the console renders these as
 * something a human clicks.
 * generated from [EnrichmentLink](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L228)
 */
export interface EnrichmentLink {
    label: string;
    url: string;
}

/**
 * One thing the station believes, and the words it read that say so. Extracted by the host out of
 * an article a plugin handed over, rather than said by any plugin: `sourceUrl` is where a person
 * checks it and `sourceQuote` is the span that supports it, and neither is ever absent.
 * generated from [FactClaim](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L321)
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
 * A track list, narrowed by what the station has of each record as well as by name.
 *
 * Its own contract rather than a field on `CatalogQuery`, because that one is shared with the artist
 * and album lists where none of these states means anything.
 * generated from [TrackQuery](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L163)
 */
export interface TrackQuery extends CatalogQuery {
    state?: TrackState;
}

export interface TrackQueryInput extends CatalogQueryInput {
    state?: TrackState;
}

/**
 * `releaseDate` is a string and not `datetime` because it is a partial date: MusicBrainz answers
 * `1997`, `1997-06` or `1997-06-24` depending on what is actually known about the release, and the
 * SDK types it the same way. A `datetime` would reject the first two or invent a day and a time
 * for them, which is a precision the source never claimed.
 * generated from [TrackEnrichmentData](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L237)
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
 * generated from [ArtistEnrichmentData](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L257)
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
 * generated from [AlbumEnrichmentData](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L268)
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
 * generated from [ArtistPage](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L201)
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
 * generated from [AlbumPage](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L206)
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
 * A track as a LIST shows it: the record, plus three facts about what the station has of it.
 *
 * Three booleans and no more, deliberately. They are what a row can afford — one `exists` each, off
 * the query that was already running — and everything wider (which providers, how many bytes, why the
 * last fetch failed) is `TrackDetail`'s, one click away. A fourth would be the beginning of putting
 * the detail page in a table cell.
 * generated from [TrackRow](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L188)
 */
export interface TrackRow extends Track {
    /** The bytes are on this machine */
    hasAudio: boolean;
    /** Measured, COMPLETE, and at a schema version the station still trusts */
    measured: boolean;
    /** At least one provider has answered about it */
    enriched: boolean;
}

export type TrackRowInput = TrackInput

/**
 * One provider's stored answer. `found: false` is a recorded miss, which is a fact rather than a
 * failure: the provider was asked, had nothing, and is not asked again until `expiresAt`. A provider
 * that could not be asked at all is `failed` instead, and the two never both hold.
 * generated from [TrackEnrichmentSource](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L285)
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
    /** The last attempt errored, so `expiresAt` is a backoff rather than a TTL */
    failed: boolean;
    data: TrackEnrichmentData;
}

export interface TrackEnrichmentSourceInput {
    data: TrackEnrichmentData;
}

/**
 * generated from [ArtistEnrichmentSource](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L296)
 */
export interface ArtistEnrichmentSource {
    provider: string;
    providerRef?: string;
    fetchedAt: string;
    expiresAt?: string;
    stale: boolean;
    found: boolean;
    /** The last attempt errored, so `expiresAt` is a backoff rather than a TTL */
    failed: boolean;
    data: ArtistEnrichmentData;
}

export interface ArtistEnrichmentSourceInput {
    data: ArtistEnrichmentData;
}

/**
 * generated from [AlbumEnrichmentSource](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L307)
 */
export interface AlbumEnrichmentSource {
    provider: string;
    providerRef?: string;
    fetchedAt: string;
    expiresAt?: string;
    stale: boolean;
    found: boolean;
    /** The last attempt errored, so `expiresAt` is a backoff rather than a TTL */
    failed: boolean;
    data: AlbumEnrichmentData;
}

export interface AlbumEnrichmentSourceInput {
    data: AlbumEnrichmentData;
}

/**
 * One page of tracks, with what the station has of each and of the whole set
 * generated from [TrackPage](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L211)
 */
export interface TrackPage {
    meta: Pagination;
    data: TrackRow[];
    states: TrackStateCounts;
}

export interface TrackPageInput {
    meta: PaginationInput;
    data: TrackRowInput[];
    states: TrackStateCountsInput;
}

/**
 * Every provider's answer, plus the same merge the promotion step used, so the console and the
 * canonical columns cannot tell different stories. `sources` is empty on a row the walk has not
 * reached yet.
 *
 * `claims` sits beside them rather than inside `merged`, because a claim is the host's own and not
 * any provider's. The articles they were read out of are deliberately NOT here: raw source prose is
 * stored and never sent.
 * generated from [TrackEnrichmentDetail](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L341)
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
 * generated from [ArtistEnrichmentDetail](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L348)
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
 * generated from [AlbumEnrichmentDetail](file://./../../../../../apps/api/data/contracts/catalog/catalog.types.ck#L355)
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
