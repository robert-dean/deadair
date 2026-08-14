import type { ArtistRef } from './enrichment.js';

/**
 * The `similarity` kind. A similarity plugin answers "who else sounds like this",
 * and optionally "what should I play by them".
 *
 * ## Why this is not part of `enrichment`
 *
 * Enrichment describes something the catalog HOLDS: the host walks its own rows,
 * stores an answer per provider against the row, and trusts it for ninety days.
 * Every part of that machinery is keyed to a catalog row.
 *
 * The artists worth asking about here are precisely the ones the catalog does not
 * hold. A station that only ever hears about acts already in its library is
 * exactly the bubble this exists to break — so the question cannot be keyed to a
 * row, and the answer is not a fact to store against one. It is a list of NAMES
 * that feeds the same pick path a chart does, where the rules already decide what
 * may actually air.
 *
 * ## Names in, names out
 *
 * Nothing here carries a track id, a provider id or a URL, and that is what keeps
 * a similarity plugin from being able to put a record on air. It suggests; the
 * host looks the suggestion up, ingests it if a provider has it, and then judges
 * it like anything else.
 *
 * Every shape here is JSON-safe.
 */

/**
 * An artist a source says resembles the one that was asked about.
 *
 * `mbid` and `providerRef` mirror {@link ArtistRef}'s: the first crosses
 * providers, the second is this plugin's own id handed back so a follow-up is a
 * lookup rather than another search. Neither is promised — the name is the only
 * field anything downstream requires, because the name is what the pick path
 * matches on.
 */
export interface SimilarArtist {
    name: string;
    /** MusicBrainz artist id, when the source knows one. */
    mbid?: string;
    /** This plugin's own id for the artist, for a later {@link SimilarityProvider.artistTopTracks}. */
    providerRef?: string;
    /**
     * How alike, from 0 to 1, where the source scores it.
     *
     * A HINT for ordering and nothing else. Sources score on wildly different
     * bases — co-listening, tags, editorial — so the host orders within one
     * source's answer and never compares two sources' numbers as if they meant
     * the same thing.
     */
    match?: number;
}

/**
 * A record by an artist, offered as something to play.
 *
 * The same shape a chart entry reduces to, and for the same reason: it is a
 * title and a lead artist, which is what a pick is.
 */
export interface ArtistTrack {
    title: string;
    /**
     * The LEAD artist, never a credit line.
     *
     * The same correctness rule the chart capability carries: everything
     * downstream matches a pick on the lead artist alone, so a joined credit is
     * a record that is named correctly and then dropped as one nothing can find.
     */
    artist: string;
    album?: string;
    year?: number;
}

/**
 * Implemented by a `similarity` plugin.
 */
export interface SimilarityProvider {
    /**
     * Artists that resemble this one, best first.
     *
     * An empty array is an ordinary answer and not a failure: an unconfigured
     * plugin, an artist the source has never heard of, and one nothing resembles
     * are all "nothing to add".
     *
     * `limit` is a ceiling on what to return. Returning fewer is fine; returning
     * more wastes an upstream call, since the host trims.
     */
    similarArtists(ref: ArtistRef, limit: number): Promise<SimilarArtist[]>;

    /**
     * What to play by an artist, best first.
     *
     * Optional, the way `enrichArtist` is on the enrichment capability. A source
     * that can only say who sounds alike is a legitimate plugin — but note what
     * absent costs: the host has a name and no way to turn it into a record, so
     * a plugin without this can inform a DJ and cannot programme an hour.
     *
     * The artist here is one the caller chose, which is usually one this plugin
     * itself named. When it carries a `providerRef` this plugin put there, that
     * is its own id coming back.
     */
    artistTopTracks?(ref: ArtistRef, limit: number): Promise<ArtistTrack[]>;
}
