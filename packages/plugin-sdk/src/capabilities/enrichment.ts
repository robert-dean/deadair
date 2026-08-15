/**
 * The `enrichment` kind. An enrichment plugin takes a reference to something in
 * the catalog and returns extra facts about it: the stuff the DJ talks over,
 * the stuff the UI shows. Several enrichment plugins run for the same thing and
 * the host merges their results in `priority` order.
 *
 * Three references, three answers, because the facts have three different
 * lifetimes and three different costs. A recording is asked about once per
 * track, an artist once per artist, and a record once per album — so a rotation
 * that revisits the same few hundred artists pays for them once rather than
 * once per song. Only `enrichTrack` is required.
 *
 * Every shape here is JSON-safe.
 */

/**
 * How an enrichment plugin is asked to identify a track. `isrc` is the
 * preferred key when present; otherwise match on the normalised
 * `artist|title` pair.
 */
export interface TrackRef {
    /** Recording ISRC. When set, prefer it over the string fields. */
    isrc?: string;
    /**
     * MusicBrainz RECORDING id, when the catalog has resolved one.
     *
     * The mirror of {@link ArtistRef.mbid} and {@link AlbumRef.mbid}, and it
     * arrives the same way: something already resolved it and the host promoted
     * it onto `tracks.mbid`, so a later pass gets it for free. Prefer it over
     * every other field here when your source can take one, because it is the
     * only identifier in this shape that cannot match the wrong record.
     */
    mbid?: string;
    /** Primary artist name, as the source provider spells it. */
    artist: string;
    title: string;
    album?: string;
    durationMs?: number;
    /** Release year, when known. Cheap disambiguator for covers and re-issues. */
    year?: number;
}

/** Match keys an enrichment plugin can look a track up by. */
export const ENRICHMENT_MATCH_KEY_ISRC = 'isrc';
export const ENRICHMENT_MATCH_KEY_ARTIST_TITLE = 'artist-title';

export const KNOWN_ENRICHMENT_MATCH_KEYS = [ENRICHMENT_MATCH_KEY_ISRC, ENRICHMENT_MATCH_KEY_ARTIST_TITLE] as const;

export type EnrichmentMatchKey = (typeof KNOWN_ENRICHMENT_MATCH_KEYS)[number];

/** A named external identifier, e.g. `{ source: 'musicbrainz', id: '...' }`. */
export interface ExternalId {
    source: string;
    id: string;
}

/** A link out to the source, shown in the UI and usable as a citation. */
export interface ExternalLink {
    label: string;
    url: string;
}

/**
 * A piece of PROSE about this thing, handed over for the host to read rather
 * than for anyone to say.
 *
 * The difference between this and {@link TrackEnrichment.facts} is who wrote
 * the sentence. A `fact` is a line your plugin composed and is willing to have
 * spoken on air unchanged. A document is somebody else's article, verbatim: the
 * host extracts claims from it, checks each claim against the text, and keeps
 * the provenance. Nothing reads a document aloud, and nothing shows one on a
 * page.
 *
 * Hand over the prose rather than your own summary of it. The host stores it,
 * so a better extraction later costs no request to your upstream, and
 * `sourceQuote` on the claims it produces has to be a span that really occurs
 * in `text` or the claim is dropped.
 *
 * Plain text, not HTML and not wiki markup. Strip the furniture (navigation,
 * licence footers, reference markers) the way a reader would ignore it.
 */
export interface SourceDocument {
    /** Where this text can be read by a person. Becomes the claim's citation, so it must be public. */
    url: string;
    /** The document's own title, e.g. the article name. */
    title: string;
    /** The prose, as plain text. */
    text: string;
    /** ISO-8601 instant. Never a `Date`. */
    retrievedAt: string;
}

/**
 * How an enrichment plugin is asked to identify an artist.
 *
 * Two identifiers, and the difference between them matters. `mbid` is the one
 * id that crosses providers, so a plugin that is not MusicBrainz can still use
 * it (Last.fm takes one directly) or ignore it and match on `name`.
 * `providerRef` is this plugin's *own* last id for this artist, handed back so
 * a second pass is a lookup rather than another search. Neither is promised:
 * the first time anything asks about an artist, all there is is a name.
 */
export interface ArtistRef {
    /** Canonical artist name, as the catalog holds it. */
    name: string;
    /** MusicBrainz artist id, when the catalog has resolved one. */
    mbid?: string;
    /** The id this plugin itself used last time it answered about this artist. */
    providerRef?: string;
}

/** The album equivalent of {@link ArtistRef}. `mbid` is a MusicBrainz release-group id. */
export interface AlbumRef {
    name: string;
    /** The album's artist, because a title alone does not identify a record. */
    artist: string;
    /** MusicBrainz release-group id, when the catalog has resolved one. */
    mbid?: string;
    providerRef?: string;
}

/**
 * The union of facts enrichment can contribute. Every field is optional: a
 * plugin returns a `Partial<TrackEnrichment>` containing only what it knows.
 */
export interface TrackEnrichment {
    /**
     * Your own id for this thing, so the next pass can be a lookup rather than
     * another search. The mirror of the `providerRef` on the ref you were
     * handed: the host stores it against your plugin and gives it back to you,
     * and only to you.
     *
     * Say it outright whenever you have one. It is not identity and it is not a
     * claim about anyone else's ids — put those in {@link externalIds}, in
     * whatever order suits you.
     */
    providerRef: string;

    /** Canonical artist name, if the source has a better spelling than the provider. */
    artist: string;
    title: string;
    album: string;

    /** Original release year of the recording. */
    year: number;
    /** ISO-8601 date string (`YYYY-MM-DD` or `YYYY`). Never a `Date`. */
    releaseDate: string;

    genres: string[];
    moods: string[];

    /** Free-text background: label, session players, chart history. DJ patter fodder. */
    biography: string;
    /** Short trivia lines, each independently speakable. */
    facts: string[];
    /** Source prose for the host to extract claims from. See {@link SourceDocument}. */
    documents: SourceDocument[];

    /** Beats per minute. */
    bpm: number;
    /** Musical key, e.g. `A minor`. */
    musicalKey: string;

    label: string;
    isrc: string;

    artworkUrl: string;

    externalIds: ExternalId[];
    links: ExternalLink[];
}

/**
 * What enrichment can say about an artist rather than a recording.
 *
 * Asked once per artist instead of once per track, which is the whole point of
 * it being a separate method: a rotation revisits the same few hundred artists
 * constantly, and an artist's background changes on a scale of years.
 */
export interface ArtistEnrichment {
    /** Your own id for this artist. See {@link TrackEnrichment.providerRef}. */
    providerRef: string;

    /** Canonical artist name, if the source has a better spelling than the provider. */
    name: string;
    /** Free-text background. DJ patter fodder. */
    biography: string;
    /** Short trivia lines, each independently speakable. */
    facts: string[];
    /** Source prose for the host to extract claims from. See {@link SourceDocument}. */
    documents: SourceDocument[];
    genres: string[];
    imageUrl: string;
    externalIds: ExternalId[];
    links: ExternalLink[];
}

/**
 * What enrichment can say about a record rather than a recording.
 *
 * The label, the pressing and the cover belong to the release, not to any one
 * track on it, so they are asked for once per album. A track's own
 * `TrackEnrichment.label` is still meaningful for a single that was never on a
 * record, or for a compilation whose tracks were licensed separately.
 */
export interface AlbumEnrichment {
    /** Your own id for this record. See {@link TrackEnrichment.providerRef}. */
    providerRef: string;

    name: string;
    /** Canonical artist name for the album, which is not always the track's. */
    artist: string;
    /** Release year of this record, as opposed to of any recording on it. */
    year: number;
    /** ISO-8601 date string (`YYYY-MM-DD` or `YYYY`). Never a `Date`. */
    releaseDate: string;
    label: string;
    genres: string[];
    facts: string[];
    /** Source prose for the host to extract claims from. See {@link SourceDocument}. */
    documents: SourceDocument[];
    artworkUrl: string;
    externalIds: ExternalId[];
    links: ExternalLink[];
}

/**
 * Implemented by an `enrichment` plugin.
 */
export interface EnrichmentProvider {
    /**
     * Lower runs first and wins conflicts on merge. Use 100 for a canonical
     * source (MusicBrainz), 500 for a supplementary one, 900 for a guess.
     */
    priority: number;

    /** Which of the {@link TrackRef} fields this plugin can actually match on. */
    matchKeys: EnrichmentMatchKey[];

    /**
     * How many refs this plugin will take in one {@link enrichTracks} call.
     *
     * The host chunks to it, so a batch call is a small fixed number of upstream
     * round trips and can be given a deadline that means something. Ignored by a
     * plugin that does not implement `enrichTracks`.
     */
    maxBatchSize?: number;

    /** Return only the fields you actually resolved. Return `{}` on no match. */
    enrichTrack(ref: TrackRef): Promise<Partial<TrackEnrichment>>;

    /**
     * The same question as {@link enrichTrack}, asked about several tracks at
     * once. Optional, the way {@link enrichArtist} is: the host loops
     * `enrichTrack` for any plugin that does not write it, so implementing it is
     * an optimisation and never a requirement.
     *
     * Implement it only where the upstream can genuinely answer about many at
     * once. A source paced at a request per second is the case this exists for:
     * one query that identifies twenty-five tracks costs a second, where
     * twenty-five `enrichTrack` calls cost twenty-five.
     *
     * Index-aligned with `refs`: entry `i` is the answer about `refs[i]`, the
     * returned array is the same length, and `{}` at a position is a miss
     * exactly as it is for `enrichTrack`. A source that could only account for
     * some of the batch returns `{}` for the rest rather than a short array.
     */
    enrichTracks?(refs: TrackRef[]): Promise<Partial<TrackEnrichment>[]>;

    /**
     * Optional, the way a music provider's `resolveStreamUrl` is: a source
     * that only knows recordings is still a valid enrichment plugin, and the
     * host asks nothing of a plugin that did not write the method.
     *
     * Implement it for anything that belongs to the artist rather than to one
     * of their recordings. The host asks once per artist, so the same answer
     * covers every track they appear on.
     */
    enrichArtist?(ref: ArtistRef): Promise<Partial<ArtistEnrichment>>;

    /** The album equivalent of {@link enrichArtist}, asked once per record. */
    enrichAlbum?(ref: AlbumRef): Promise<Partial<AlbumEnrichment>>;
}
