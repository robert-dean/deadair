import { z } from 'zod';
import { DateTime } from 'luxon';
import { Pagination } from '../../shared/types/pagination.js';
import { PaginationInput } from '../../shared/types/pagination.js';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * What the station has been told about a record. `neutral` is the absence of an opinion rather than
 * a middling one, and it is what rating something back to nothing means.
 * generated from [Rating](file://./../../../../data/contracts/catalog/catalog.types.ck#L9)
 */
export const Rating = z.enum(['liked', 'neutral', 'disliked']);
export type Rating = z.infer<typeof Rating>;

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
 * generated from [TrackBinding](file://./../../../../data/contracts/catalog/catalog.types.ck#L73)
 */
export const TrackBinding = z.strictObject({
    sourceId: z.uuid().describe('`track_sources.id`, which is also what the audio URL carries'),
    pluginId: z.string().min(1).max(200),
    externalId: z.string().min(1).max(400),
    playable: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('False when the provider still knows the record but will not serve it here'),
    missingAt: _ZodDatetime.optional().describe('When the station gave up on this copy. Cleared by the next sync that sees it again'),
    origin: z.string().min(1).max(40).describe('`sync` if a playlist walk saw it, `discovered` if something looked it up'),
    bitrate: z.coerce.number().int().min(0).optional(),
    format: z.string().max(100).optional(),
    lastSeenAt: _ZodDatetime.optional(),
    byteSize: z.coerce.number().int().min(0).optional().describe('What the station holds of this copy, absent when nothing has ever fetched it.'),
    fetchedAt: _ZodDatetime.optional(),
    lastServedAt: _ZodDatetime.optional(),
    attempts: z.coerce.number().int().min(0).describe('CONSECUTIVE failures. Reset by a fetch that works'),
    lastError: z.string().max(2000).optional(),
    nextAttemptAt: _ZodDatetime.optional(),
});
export type TrackBinding = z.infer<typeof TrackBinding>;

export const TrackBindingInput = z.strictObject({});
export type TrackBindingInput = z.infer<typeof TrackBindingInput>;

/**
 * What the measurement sidecar made of a record.
 *
 * `complete` is NOT `analyzedAt`, and the two are separate fields for a reason `0005_music.sql`
 * argues at length: a measurement of a truncated download is confident and wrong, so every reader in
 * the app filters on `complete` and a page that showed only a date would be reporting a record as
 * measured that nothing will use the measurement of.
 * generated from [TrackAnalysis](file://./../../../../data/contracts/catalog/catalog.types.ck#L98)
 */
export const TrackAnalysis = z.strictObject({
    schemaVersion: z.coerce.number().int().min(0),
    complete: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    analyzer: z.string().max(200).optional().describe('The measuring thing itself, which is not the plugin adapting it'),
    analyzerPluginId: z.string().max(200).optional(),
    analyzedAt: _ZodDatetime.optional(),
    failedAt: _ZodDatetime.optional(),
    failureReason: z.string().max(2000).optional(),
});
export type TrackAnalysis = z.infer<typeof TrackAnalysis>;

export const TrackAnalysisInput = z.strictObject({});
export type TrackAnalysisInput = z.infer<typeof TrackAnalysisInput>;

/**
 * One airing of a record, as this page needs it: when, and under which broadcast.
 * generated from [TrackPlay](file://./../../../../data/contracts/catalog/catalog.types.ck#L109)
 */
export const TrackPlay = z.strictObject({
    airedAt: _ZodDatetime,
    broadcastId: z.uuid().optional(),
    source: z.string().min(1).max(100).describe('What put it in the running order'),
});
export type TrackPlay = z.infer<typeof TrackPlay>;

export const TrackPlayInput = z.strictObject({});
export type TrackPlayInput = z.infer<typeof TrackPlayInput>;

/**
 * What a clear actually did.
 *
 * A count rather than a bare 204, because the interesting answers are the small ones: clearing the
 * audio of a record with three copies and being told `1` is the station saying two of them were
 * never here — which is a fact about the record and not about the button.
 * generated from [TrackClearResult](file://./../../../../data/contracts/catalog/catalog.types.ck#L132)
 */
export const TrackClearResult = z.strictObject({
    trackId: z.uuid(),
    cleared: z.coerce.number().int().min(0).describe('Rows this affected. Zero is an ordinary answer, not a failure'),
    detail: z.string().min(1).max(400).describe('What happened, in the words the console shows'),
});
export type TrackClearResult = z.infer<typeof TrackClearResult>;

export const TrackClearResultInput = z.strictObject({});
export type TrackClearResultInput = z.infer<typeof TrackClearResultInput>;

/**
 * Narrow a clear to one provider's answer, for the case where one source is wrong and the rest are
 * not. Absent clears every provider's.
 * generated from [ClearEnrichmentQuery](file://./../../../../data/contracts/catalog/catalog.types.ck#L140)
 */
export const ClearEnrichmentQuery = z.strictObject({
    provider: z.string().min(1).max(200).optional(),
});
export type ClearEnrichmentQuery = z.infer<typeof ClearEnrichmentQuery>;

/**
 * Pagination plus a name filter. Every list operation here takes it, so the console's search box
 * narrows server-side rather than filtering one page client-side and lying about the total.
 * generated from [CatalogQuery](file://./../../../../data/contracts/catalog/catalog.types.ck#L146)
 */
export const CatalogQuery = Pagination.extend({
    search: z.string().min(1).max(200).optional(),
});
export type CatalogQuery = z.infer<typeof CatalogQuery>;

export const CatalogQueryInput = PaginationInput.extend({
    search: z.string().min(1).max(200).optional(),
});
export type CatalogQueryInput = z.infer<typeof CatalogQueryInput>;

/**
 * Which records to show, by what the station has of them rather than by what they are.
 *
 *   cached      the audio is on this machine, so it can be committed to the running order now
 *   uncached    it is not, which for most of a library is ordinary rather than wrong
 *   unmeasured  no trustworthy measurement, so no cue points and no level decided before air
 *   benched     every copy written off, which is the one state that means it CANNOT air
 *   failing     a fetch has failed and is backing off. Not benched yet, and often the state before it
 * generated from [TrackState](file://./../../../../data/contracts/catalog/catalog.types.ck#L157)
 */
export const TrackState = z.enum(['cached', 'uncached', 'unmeasured', 'benched', 'failing']);
export type TrackState = z.infer<typeof TrackState>;

/**
 * How much of the library is in each state, over the whole filtered set rather than this page.
 *
 * The aggregate is what an operator reads first — "13 of 581 measured" is the sentence that made
 * `docs/todo/analysis-queue-ordering.md` necessary, and it was a psql query then. `total` is the
 * same number as `meta.total` when nothing is filtered, and is repeated here so the counts can be
 * read as N of M without reaching into the pager.
 * generated from [TrackStateCounts](file://./../../../../data/contracts/catalog/catalog.types.ck#L173)
 */
export const TrackStateCounts = z.strictObject({
    total: z.coerce.number().int().min(0),
    cached: z.coerce.number().int().min(0),
    measured: z.coerce.number().int().min(0),
    enriched: z.coerce.number().int().min(0),
    benched: z.coerce.number().int().min(0),
    failing: z.coerce.number().int().min(0),
});
export type TrackStateCounts = z.infer<typeof TrackStateCounts>;

export const TrackStateCountsInput = z.strictObject({});
export type TrackStateCountsInput = z.infer<typeof TrackStateCountsInput>;

/**
 * generated from [EnrichmentExternalId](file://./../../../../data/contracts/catalog/catalog.types.ck#L221)
 */
export const EnrichmentExternalId = z.strictObject({
    source: z.string().min(1).max(200).describe('e.g. `musicbrainz`, `wikidata`'),
    id: z.string().min(1).max(200),
});
export type EnrichmentExternalId = z.infer<typeof EnrichmentExternalId>;

/**
 * Narrowed to http(s) by the host before it is stored, since the console renders these as
 * something a human clicks.
 * generated from [EnrichmentLink](file://./../../../../data/contracts/catalog/catalog.types.ck#L228)
 */
export const EnrichmentLink = z.strictObject({
    label: z.string().min(1).max(200),
    url: z.string().min(1).max(2000),
});
export type EnrichmentLink = z.infer<typeof EnrichmentLink>;

/**
 * One thing the station believes, and the words it read that say so. Extracted by the host out of
 * an article a plugin handed over, rather than said by any plugin: `sourceUrl` is where a person
 * checks it and `sourceQuote` is the span that supports it, and neither is ever absent.
 * generated from [FactClaim](file://./../../../../data/contracts/catalog/catalog.types.ck#L321)
 */
export const FactClaim = z.strictObject({
    id: z.uuid(),
    claim: z.string().min(1).max(500).describe('One sentence, as the DJ would say it'),
    category: z.string().min(1).max(40),
    source: z.string().min(1).max(20).describe("`lead` for the article's own opening, `model` for what a model found"),
    sourceProvider: z.string().min(1).max(200),
    sourceUrl: z.string().min(1).max(2000),
    sourceQuote: z.string().min(1).max(2000),
    confidence: z.coerce.number().optional(),
    model: z.string().max(200).optional(),
    lastUsedAt: _ZodDatetime.optional().describe('Absent means never said on air'),
});
export type FactClaim = z.infer<typeof FactClaim>;

export const FactClaimInput = z.strictObject({});
export type FactClaimInput = z.infer<typeof FactClaimInput>;

/**
 * Rate an artist, a record or a song. Ratings are absolute: a dislike anywhere above a track
 * excludes it, and nothing the station programmes may turn that off.
 * generated from [RateInput](file://./../../../../data/contracts/catalog/catalog.types.ck#L13)
 */
export const RateInput = z.strictObject({
    rating: Rating,
});
export type RateInput = z.infer<typeof RateInput>;

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
 * generated from [Artist](file://./../../../../data/contracts/catalog/catalog.types.ck#L26)
 */
export const Artist = z.strictObject({
    id: z.uuid(),
    name: z.string(),
    mbid: z.uuid().optional().describe('MusicBrainz artist id, absent until enrichment resolves one'),
    imageUrl: z.string().optional().describe('Absolute upstream URL, or an API-relative path to the local copy'),
    rating: Rating.default('neutral'),
    albumCount: z.coerce.number().int().min(0).describe('Unmerged albums credited to this artist'),
    trackCount: z.coerce.number().int().min(0).describe('Unmerged tracks credited to this artist'),
});
export type Artist = z.infer<typeof Artist>;

export const ArtistInput = z.strictObject({
    name: z.string(),
    mbid: z.uuid().optional().describe('MusicBrainz artist id, absent until enrichment resolves one'),
    imageUrl: z.string().optional().describe('Absolute upstream URL, or an API-relative path to the local copy'),
    rating: Rating.default('neutral'),
});
export type ArtistInput = z.infer<typeof ArtistInput>;

/**
 * generated from [Album](file://./../../../../data/contracts/catalog/catalog.types.ck#L36)
 */
export const Album = z.strictObject({
    id: z.uuid(),
    name: z.string(),
    artistId: z.uuid(),
    artistName: z.string().describe('Joined, so a list renders without a second request per row'),
    mbid: z.uuid().optional().describe('MusicBrainz release-group id, absent until enrichment resolves one'),
    year: z.coerce.number().int().optional(),
    imageUrl: z.string().optional().describe('Absolute upstream URL, or an API-relative path to the local copy'),
    rating: Rating.default('neutral'),
    trackCount: z.coerce.number().int().min(0),
});
export type Album = z.infer<typeof Album>;

export const AlbumInput = z.strictObject({
    name: z.string(),
    mbid: z.uuid().optional().describe('MusicBrainz release-group id, absent until enrichment resolves one'),
    year: z.coerce.number().int().optional(),
    imageUrl: z.string().optional().describe('Absolute upstream URL, or an API-relative path to the local copy'),
    rating: Rating.default('neutral'),
});
export type AlbumInput = z.infer<typeof AlbumInput>;

/**
 * generated from [Track](file://./../../../../data/contracts/catalog/catalog.types.ck#L48)
 */
export const Track = z.strictObject({
    id: z.uuid(),
    title: z.string(),
    artistId: z.uuid(),
    artistName: z.string(),
    albumId: z.uuid().optional().describe('Absent on a single ingested outside any release: `tracks.album_id` is nullable'),
    albumName: z.string().optional(),
    albumImageUrl: z.string().optional().describe("The record's cover, in the two spellings `Album.imageUrl` has. Nothing hangs art off a recording"),
    artists: z.string().describe('Display credit as written on the release ("X feat. Y"), not a join key'),
    genre: z.string().optional(),
    year: z.coerce.number().int().optional(),
    durationMs: z.coerce.number().int().min(0).optional(),
    rating: Rating.default('neutral'),
});
export type Track = z.infer<typeof Track>;

export const TrackInput = z.strictObject({
    title: z.string(),
    artists: z.string().describe('Display credit as written on the release ("X feat. Y"), not a join key'),
    genre: z.string().optional(),
    year: z.coerce.number().int().optional(),
    durationMs: z.coerce.number().int().min(0).optional(),
    rating: Rating.default('neutral'),
});
export type TrackInput = z.infer<typeof TrackInput>;

/**
 * A track list, narrowed by what the station has of each record as well as by name.
 *
 * Its own contract rather than a field on `CatalogQuery`, because that one is shared with the artist
 * and album lists where none of these states means anything.
 * generated from [TrackQuery](file://./../../../../data/contracts/catalog/catalog.types.ck#L163)
 */
export const TrackQuery = CatalogQuery.extend({
    state: TrackState.optional(),
});
export type TrackQuery = z.infer<typeof TrackQuery>;

export const TrackQueryInput = CatalogQueryInput.extend({
    state: TrackState.optional(),
});
export type TrackQueryInput = z.infer<typeof TrackQueryInput>;

/**
 * `releaseDate` is a string and not `datetime` because it is a partial date: MusicBrainz answers
 * `1997`, `1997-06` or `1997-06-24` depending on what is actually known about the release, and the
 * SDK types it the same way. A `datetime` would reject the first two or invent a day and a time
 * for them, which is a precision the source never claimed.
 * generated from [TrackEnrichmentData](file://./../../../../data/contracts/catalog/catalog.types.ck#L237)
 */
export const TrackEnrichmentData = z.strictObject({
    artist: z.string().max(2000).optional(),
    title: z.string().max(2000).optional(),
    album: z.string().max(2000).optional(),
    year: z.coerce.number().int().optional(),
    releaseDate: z.string().max(10).optional(),
    genres: z.array(z.string().max(2000)).optional(),
    moods: z.array(z.string().max(2000)).optional(),
    biography: z.string().max(20000).optional(),
    facts: z.array(z.string().max(2000)).optional().describe('Short lines, each independently speakable'),
    bpm: z.coerce.number().optional().describe('Not an integer: a tempo a source measured rather than declared is fractional'),
    musicalKey: z.string().max(2000).optional(),
    label: z.string().max(2000).optional(),
    isrc: z.string().max(2000).optional(),
    artworkUrl: z.string().max(2000).optional(),
    externalIds: z.array(EnrichmentExternalId).optional(),
    links: z.array(EnrichmentLink).optional(),
    extra: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('What the plugin said that the SDK has no field for. Per provider only: the merged view drops it'),
});
export type TrackEnrichmentData = z.infer<typeof TrackEnrichmentData>;

/**
 * generated from [ArtistEnrichmentData](file://./../../../../data/contracts/catalog/catalog.types.ck#L257)
 */
export const ArtistEnrichmentData = z.strictObject({
    name: z.string().max(2000).optional(),
    biography: z.string().max(20000).optional(),
    imageUrl: z.string().max(2000).optional(),
    genres: z.array(z.string().max(2000)).optional(),
    facts: z.array(z.string().max(2000)).optional(),
    externalIds: z.array(EnrichmentExternalId).optional(),
    links: z.array(EnrichmentLink).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
});
export type ArtistEnrichmentData = z.infer<typeof ArtistEnrichmentData>;

/**
 * generated from [AlbumEnrichmentData](file://./../../../../data/contracts/catalog/catalog.types.ck#L268)
 */
export const AlbumEnrichmentData = z.strictObject({
    name: z.string().max(2000).optional(),
    artist: z.string().max(2000).optional().describe("The record's own credit, which is not always the track's"),
    year: z.coerce.number().int().optional(),
    releaseDate: z.string().max(10).optional().describe('Partial, exactly as on TrackEnrichmentData'),
    label: z.string().max(2000).optional(),
    genres: z.array(z.string().max(2000)).optional(),
    facts: z.array(z.string().max(2000)).optional(),
    artworkUrl: z.string().max(2000).optional(),
    externalIds: z.array(EnrichmentExternalId).optional(),
    links: z.array(EnrichmentLink).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
});
export type AlbumEnrichmentData = z.infer<typeof AlbumEnrichmentData>;

/**
 * One page of artists, with the totals the request was counted against
 * generated from [ArtistPage](file://./../../../../data/contracts/catalog/catalog.types.ck#L201)
 */
export const ArtistPage = z.strictObject({
    meta: Pagination,
    data: z.array(Artist),
});
export type ArtistPage = z.infer<typeof ArtistPage>;

export const ArtistPageInput = z.strictObject({
    meta: PaginationInput,
    data: z.array(ArtistInput),
});
export type ArtistPageInput = z.infer<typeof ArtistPageInput>;

/**
 * One page of albums
 * generated from [AlbumPage](file://./../../../../data/contracts/catalog/catalog.types.ck#L206)
 */
export const AlbumPage = z.strictObject({
    meta: Pagination,
    data: z.array(Album),
});
export type AlbumPage = z.infer<typeof AlbumPage>;

export const AlbumPageInput = z.strictObject({
    meta: PaginationInput,
    data: z.array(AlbumInput),
});
export type AlbumPageInput = z.infer<typeof AlbumPageInput>;

/**
 * Everything one record has accumulated, in one read.
 *
 * The enrichment is deliberately NOT here. It has its own operation already, answering
 * `TrackEnrichmentDetail` with every provider's payload and the station's own sourced claims, and
 * the console draws it through the same panel the list uses. One enrichment shape rather than two.
 * generated from [TrackDetail](file://./../../../../data/contracts/catalog/catalog.types.ck#L120)
 */
export const TrackDetail = Track.extend({
    bindings: z.array(TrackBinding),
    analysis: TrackAnalysis.optional().describe('Absent for a record the walk has not reached'),
    plays: z.array(TrackPlay).describe('The most recent airings, newest first'),
    playCount: z.coerce.number().int().min(0).describe('How many times in all, which the list above is only the head of'),
});
export type TrackDetail = z.infer<typeof TrackDetail>;

export const TrackDetailInput = TrackInput.extend({
    bindings: z.array(TrackBindingInput),
    analysis: TrackAnalysisInput.optional().describe('Absent for a record the walk has not reached'),
    plays: z.array(TrackPlayInput).describe('The most recent airings, newest first'),
});
export type TrackDetailInput = z.infer<typeof TrackDetailInput>;

/**
 * A track as a LIST shows it: the record, plus three facts about what the station has of it.
 *
 * Three booleans and no more, deliberately. They are what a row can afford — one `exists` each, off
 * the query that was already running — and everything wider (which providers, how many bytes, why the
 * last fetch failed) is `TrackDetail`'s, one click away. A fourth would be the beginning of putting
 * the detail page in a table cell.
 * generated from [TrackRow](file://./../../../../data/contracts/catalog/catalog.types.ck#L188)
 */
export const TrackRow = Track.extend({
    hasAudio: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).describe('The bytes are on this machine'),
    measured: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Measured, COMPLETE, and at a schema version the station still trusts'),
    enriched: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('At least one provider has answered about it'),
});
export type TrackRow = z.infer<typeof TrackRow>;

export const TrackRowInput = TrackInput.extend({});
export type TrackRowInput = z.infer<typeof TrackRowInput>;

/**
 * One provider's stored answer. `found: false` is a recorded miss, which is a fact rather than a
 * failure: the provider was asked, had nothing, and is not asked again until `expiresAt`. A provider
 * that could not be asked at all is `failed` instead, and the two never both hold.
 * generated from [TrackEnrichmentSource](file://./../../../../data/contracts/catalog/catalog.types.ck#L285)
 */
export const TrackEnrichmentSource = z.strictObject({
    provider: z.string().min(1).max(200),
    providerRef: z.string().max(200).optional().describe('The id it was fetched under. Provenance, not identity'),
    fetchedAt: _ZodDatetime,
    expiresAt: _ZodDatetime.optional(),
    stale: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Past its TTL, so the next pass will ask again'),
    found: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    failed: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('The last attempt errored, so `expiresAt` is a backoff rather than a TTL'),
    data: TrackEnrichmentData,
});
export type TrackEnrichmentSource = z.infer<typeof TrackEnrichmentSource>;

export const TrackEnrichmentSourceInput = z.strictObject({
    data: TrackEnrichmentData,
});
export type TrackEnrichmentSourceInput = z.infer<typeof TrackEnrichmentSourceInput>;

/**
 * generated from [ArtistEnrichmentSource](file://./../../../../data/contracts/catalog/catalog.types.ck#L296)
 */
export const ArtistEnrichmentSource = z.strictObject({
    provider: z.string().min(1).max(200),
    providerRef: z.string().max(200).optional(),
    fetchedAt: _ZodDatetime,
    expiresAt: _ZodDatetime.optional(),
    stale: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    found: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    failed: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('The last attempt errored, so `expiresAt` is a backoff rather than a TTL'),
    data: ArtistEnrichmentData,
});
export type ArtistEnrichmentSource = z.infer<typeof ArtistEnrichmentSource>;

export const ArtistEnrichmentSourceInput = z.strictObject({
    data: ArtistEnrichmentData,
});
export type ArtistEnrichmentSourceInput = z.infer<typeof ArtistEnrichmentSourceInput>;

/**
 * generated from [AlbumEnrichmentSource](file://./../../../../data/contracts/catalog/catalog.types.ck#L307)
 */
export const AlbumEnrichmentSource = z.strictObject({
    provider: z.string().min(1).max(200),
    providerRef: z.string().max(200).optional(),
    fetchedAt: _ZodDatetime,
    expiresAt: _ZodDatetime.optional(),
    stale: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    found: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    failed: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('The last attempt errored, so `expiresAt` is a backoff rather than a TTL'),
    data: AlbumEnrichmentData,
});
export type AlbumEnrichmentSource = z.infer<typeof AlbumEnrichmentSource>;

export const AlbumEnrichmentSourceInput = z.strictObject({
    data: AlbumEnrichmentData,
});
export type AlbumEnrichmentSourceInput = z.infer<typeof AlbumEnrichmentSourceInput>;

/**
 * One page of tracks, with what the station has of each and of the whole set
 * generated from [TrackPage](file://./../../../../data/contracts/catalog/catalog.types.ck#L211)
 */
export const TrackPage = z.strictObject({
    meta: Pagination,
    data: z.array(TrackRow),
    states: TrackStateCounts,
});
export type TrackPage = z.infer<typeof TrackPage>;

export const TrackPageInput = z.strictObject({
    meta: PaginationInput,
    data: z.array(TrackRowInput),
    states: TrackStateCountsInput,
});
export type TrackPageInput = z.infer<typeof TrackPageInput>;

/**
 * Every provider's answer, plus the same merge the promotion step used, so the console and the
 * canonical columns cannot tell different stories. `sources` is empty on a row the walk has not
 * reached yet.
 *
 * `claims` sits beside them rather than inside `merged`, because a claim is the host's own and not
 * any provider's. The articles they were read out of are deliberately NOT here: raw source prose is
 * stored and never sent.
 * generated from [TrackEnrichmentDetail](file://./../../../../data/contracts/catalog/catalog.types.ck#L341)
 */
export const TrackEnrichmentDetail = z.strictObject({
    trackId: z.uuid(),
    merged: TrackEnrichmentData,
    sources: z.array(TrackEnrichmentSource),
    claims: z.array(FactClaim),
});
export type TrackEnrichmentDetail = z.infer<typeof TrackEnrichmentDetail>;

export const TrackEnrichmentDetailInput = z.strictObject({
    merged: TrackEnrichmentData,
    sources: z.array(TrackEnrichmentSourceInput),
    claims: z.array(FactClaimInput),
});
export type TrackEnrichmentDetailInput = z.infer<typeof TrackEnrichmentDetailInput>;

/**
 * generated from [ArtistEnrichmentDetail](file://./../../../../data/contracts/catalog/catalog.types.ck#L348)
 */
export const ArtistEnrichmentDetail = z.strictObject({
    artistId: z.uuid(),
    merged: ArtistEnrichmentData,
    sources: z.array(ArtistEnrichmentSource),
    claims: z.array(FactClaim),
});
export type ArtistEnrichmentDetail = z.infer<typeof ArtistEnrichmentDetail>;

export const ArtistEnrichmentDetailInput = z.strictObject({
    merged: ArtistEnrichmentData,
    sources: z.array(ArtistEnrichmentSourceInput),
    claims: z.array(FactClaimInput),
});
export type ArtistEnrichmentDetailInput = z.infer<typeof ArtistEnrichmentDetailInput>;

/**
 * generated from [AlbumEnrichmentDetail](file://./../../../../data/contracts/catalog/catalog.types.ck#L355)
 */
export const AlbumEnrichmentDetail = z.strictObject({
    albumId: z.uuid(),
    merged: AlbumEnrichmentData,
    sources: z.array(AlbumEnrichmentSource),
    claims: z.array(FactClaim),
});
export type AlbumEnrichmentDetail = z.infer<typeof AlbumEnrichmentDetail>;

export const AlbumEnrichmentDetailInput = z.strictObject({
    merged: AlbumEnrichmentData,
    sources: z.array(AlbumEnrichmentSourceInput),
    claims: z.array(FactClaimInput),
});
export type AlbumEnrichmentDetailInput = z.infer<typeof AlbumEnrichmentDetailInput>;
