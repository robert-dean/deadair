/**
 * The `enrichment` kind. An enrichment plugin takes a track reference and
 * returns extra facts about it: the stuff the DJ talks over, the stuff the UI
 * shows. Several enrichment plugins run for the same track and the host merges
 * their results in `priority` order.
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
 * The union of facts enrichment can contribute. Every field is optional: a
 * plugin returns a `Partial<TrackEnrichment>` containing only what it knows.
 */
export interface TrackEnrichment {
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

    /** Return only the fields you actually resolved. Return `{}` on no match. */
    enrichTrack(ref: TrackRef): Promise<Partial<TrackEnrichment>>;
}
