import type { AlbumEnrichment, ArtistEnrichment, TrackEnrichment } from '@deadair/plugin-sdk';

import { splitTags } from './lastfm.tags.js';
import { artistNameOf, asNumber, largestImage, type LastfmAlbum, type LastfmArtist, type LastfmTrack, type LastfmWiki } from './lastfm.types.js';

/**
 * Last.fm's answers, in the SDK's shapes.
 *
 * ## What this source is for, and what it is not
 *
 * It runs at priority 500 — supplementary, per the SDK's own scale — and the
 * fields it declines are as deliberate as the ones it fills. It says nothing
 * about `year`, `releaseDate`, `label`, `isrc` or the artist's canonical
 * spelling, because those are identity and MusicBrainz at priority 100 is the
 * source for them. A merge where a folksonomy corrected the identity database's
 * release year would be the wrong way round.
 *
 * What it adds is what no identity database sells: what people call this record,
 * how many of them are listening, and a paragraph about the artist.
 *
 * ## The biography is edited, not copied
 *
 * Every `wiki` field ends with a licence footer and an HTML link back to the
 * page. Both are stripped: the biography reaches a language model that is
 * writing something to say on air, and a paragraph ending in "Read more on
 * Last.fm" is a sentence the DJ will eventually read out.
 */

/** How many genres, and separately how many moods, one entity may contribute. */
const MAX_TAGS = 12;

/**
 * The footer Last.fm appends to every wiki body.
 *
 * Matched from the link rather than from the words, because the words are
 * localized and the markup is not.
 */
const WIKI_FOOTER = /\s*<a href="https:\/\/www\.last\.fm[^>]*>[^<]*<\/a>[\s.]*$/i;

/** Anything else that arrives as markup. The bodies are plain text with the odd link in them. */
const TAGS = /<[^>]+>/g;

/**
 * A wiki body as prose.
 *
 * `summary` rather than `content` where both exist: the summary is a paragraph
 * and the content is an essay, and what reads this is a prompt with a budget.
 */
export function readWiki(wiki: LastfmWiki | undefined): string | undefined {
    const body = wiki?.summary?.trim() ?? wiki?.content?.trim();
    if (!body) return undefined;

    const text = body.replace(WIKI_FOOTER, '').replace(TAGS, '').replace(/\s+/g, ' ').trim();
    return text.length > 0 ? text : undefined;
}

/** What Last.fm knows about a recording. */
export function mapTrack(track: LastfmTrack, minTagWeight: number, includeTags: boolean): Partial<TrackEnrichment> {
    const mapped: Partial<TrackEnrichment> = {};
    const extra: Record<string, unknown> = {};

    const title = track.name?.trim();
    if (title) mapped.providerRef = trackRef(artistNameOf(track.artist), title);

    if (includeTags) {
        const { genres, moods, raw } = splitTags(track.toptags?.tag, minTagWeight, MAX_TAGS);
        if (genres.length > 0) mapped.genres = genres;
        if (moods.length > 0) mapped.moods = moods;
        if (raw.length > 0) extra.tags = raw;
    }

    // Deliberately NOT `biography`: a track wiki is about the recording and the
    // artist's is about them, and the merge would take whichever arrived first.
    // The track's goes in `facts`, where a writer reads it as one line among
    // several, and the artist's is the one that fills `biography`.
    const wiki = readWiki(track.wiki);
    if (wiki) mapped.facts = [wiki];

    // The listener count stops here, in `extra` where the console can still read
    // it. It was a `fact` for as long as this file existed, and a fact is a thing
    // the DJ says out loud: on this catalog that came out as seven hundred rows of
    // "has around 160,000 listeners on Last.fm", which crowded the real facts out
    // of every break — a track's facts are preferred over its record's and its
    // artist's, so the one line worth saying lost to the one line that is not.
    // How popular a record is is a fact about Last.fm, not about the record.
    const listeners = asNumber(track.listeners);
    if (listeners !== undefined) extra.listeners = listeners;
    const playcount = asNumber(track.playcount);
    if (playcount !== undefined) extra.playcount = playcount;

    const album = track.album?.title?.trim();
    if (album) mapped.album = album;

    const url = track.url?.trim();
    if (url) mapped.links = [{ label: 'Last.fm', url }];

    if (track.mbid?.trim()) mapped.externalIds = [{ source: 'musicbrainz', id: track.mbid.trim() }];

    if (Object.keys(extra).length > 0) Object.assign(mapped, { extra });
    return mapped;
}

/** What Last.fm knows about an artist, which is the richest of the three. */
export function mapArtist(artist: LastfmArtist, minTagWeight: number, includeTags: boolean): Partial<ArtistEnrichment> {
    const mapped: Partial<ArtistEnrichment> = {};
    const extra: Record<string, unknown> = {};

    const name = artist.name?.trim();
    if (name) mapped.providerRef = name;

    if (includeTags) {
        const { genres, raw } = splitTags(artist.tags?.tag, minTagWeight, MAX_TAGS);
        if (genres.length > 0) mapped.genres = genres;
        if (raw.length > 0) extra.tags = raw;
    }

    const bio = readWiki(artist.bio);
    if (bio) mapped.biography = bio;

    // No `facts` at all from this source now: see the note in `mapTrack`. What
    // Last.fm has to say about an artist is the biography above, which is prose
    // somebody wrote, and the numbers below, which are not.
    const listeners = asNumber(artist.stats?.listeners);
    if (listeners !== undefined) extra.listeners = listeners;
    const playcount = asNumber(artist.stats?.playcount);
    if (playcount !== undefined) extra.playcount = playcount;

    // `imageUrl` is deliberately never filled. Last.fm lost the rights to artist
    // images years ago and now answers every artist with the same grey star
    // placeholder, so filling the field would put an identical wrong picture on
    // every artist page — and the merge would prefer it over a source with a real
    // one, since lists accumulate but scalars go to the first plugin with an
    // opinion.
    const url = artist.url?.trim();
    if (url) mapped.links = [{ label: 'Last.fm', url }];

    if (artist.mbid?.trim()) mapped.externalIds = [{ source: 'musicbrainz-artist', id: artist.mbid.trim() }];

    if (Object.keys(extra).length > 0) Object.assign(mapped, { extra });
    return mapped;
}

/** What Last.fm knows about a record. Thinner than the other two: it is not a release database. */
export function mapAlbum(album: LastfmAlbum, minTagWeight: number, includeTags: boolean): Partial<AlbumEnrichment> {
    const mapped: Partial<AlbumEnrichment> = {};
    const extra: Record<string, unknown> = {};

    const name = album.name?.trim();
    const artist = album.artist?.trim();
    if (name && artist) mapped.providerRef = albumRef(artist, name);

    if (includeTags && typeof album.tags !== 'string') {
        const { genres, raw } = splitTags(album.tags?.tag, minTagWeight, MAX_TAGS);
        if (genres.length > 0) mapped.genres = genres;
        if (raw.length > 0) extra.tags = raw;
    }

    const wiki = readWiki(album.wiki);
    if (wiki) mapped.facts = [wiki];

    const listeners = asNumber(album.listeners);
    if (listeners !== undefined) extra.listeners = listeners;

    // Cover art IS worth taking here, unlike the artist image: album art is
    // supplied by the label and is real. It still loses to MusicBrainz's Cover
    // Art Archive on the merge, which is the right order — that one is the
    // pressing the catalog actually holds.
    const artwork = largestImage(album.image);
    if (artwork) mapped.artworkUrl = artwork;

    const url = album.url?.trim();
    if (url) mapped.links = [{ label: 'Last.fm', url }];

    // A RELEASE id, never a release group, which is the same fact `enrichAlbum` above already acts
    // on when it refuses to send this endpoint an `albums.mbid`. Read out of the answer it is the
    // other half of that: the host promotes `musicbrainz-release-group` onto `albums.mbid`, and
    // MusicBrainz then reads that column back as a release group and looks it up. So mislabelling it
    // here does not merely store a wrong id, it hands the record an identity its own source will
    // answer 404 to for good, since `promoteAlbum` writes the column once and never revises it.
    // Measured on this install: of 473 albums both sources described, this id equalled MusicBrainz's
    // release group 0 times and one of its releases 67 times, and 47 albums were failing every
    // enrichment pass on the strength of it.
    if (album.mbid?.trim()) mapped.externalIds = [{ source: 'musicbrainz-release', id: album.mbid.trim() }];

    if (Object.keys(extra).length > 0) Object.assign(mapped, { extra });
    return mapped;
}

/**
 * The separator inside a {@link trackRef}.
 *
 * A TAB, and the choice is narrower than it looks. It cannot be a space, since
 * both halves are full of them. It cannot be the NUL this repo uses as a
 * separator for in-memory keys, because **Postgres will not store one in a text
 * column at all** and a `providerRef` is stored — so that would fail on write
 * rather than on read. A tab is legal in `text`, survives JSON, and does not
 * occur in a title or an artist name any provider has produced.
 *
 * Written as an escape rather than as the literal character, for the reason the
 * same note gives elsewhere in this repo: typed out by hand somewhere else it is
 * invisible and builds a different key that silently never matches.
 */
const REF_SEPARATOR = '\u0009';

/**
 * This plugin's own id for a recording.
 *
 * A composite of the two things every Last.fm lookup takes, because the service
 * has no id of its own that is not an MBID it borrowed. Handed back to this
 * plugin on the next pass, where it saves a search — which is the whole contract
 * of `providerRef`.
 */
export const trackRef = (artist: string | undefined, title: string): string => `${artist ?? ''}${REF_SEPARATOR}${title}`;

/** The same, for a record. */
export const albumRef = (artist: string, name: string): string => `${artist}${REF_SEPARATOR}${name}`;

/**
 * The two halves of a {@link trackRef} or {@link albumRef}, or nothing when it is not one.
 *
 * Split at the FIRST separator, so a name containing one keeps the rest of
 * itself rather than being truncated.
 */
export function readRef(ref: string | undefined): { artist: string; name: string } | undefined {
    if (!ref) return undefined;

    const at = ref.indexOf(REF_SEPARATOR);
    if (at <= 0) return undefined;

    const artist = ref.slice(0, at).trim();
    const name = ref.slice(at + REF_SEPARATOR.length).trim();
    if (artist.length === 0 || name.length === 0) return undefined;

    return { artist, name };
}
