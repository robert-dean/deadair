/**
 * ListenBrainz metadata to {@link TrackEnrichment} fields.
 *
 * The sibling of `musicbrainz.mapping.ts`, and it emits the *same*
 * `externalIds` sources on purpose. The host promotes `tracks.mbid`,
 * `artists.mbid` and `albums.mbid` by matching on those strings, and these are
 * MusicBrainz ids that happened to arrive over a different wire — so a track
 * described this way has to be indistinguishable downstream from one described
 * by the web service, or the fast path would quietly stop filling the canonical
 * columns.
 *
 * What is missing here is missing because ListenBrainz does not carry it. There
 * is no ISRC, no label, and no date finer than a year, so this never sets
 * `isrc`, `label` or `releaseDate`. Those stay for the album pass and for the
 * per-track MusicBrainz path, and inventing them would put a guess in front of
 * the DJ under the name of the canonical source.
 */

import {
    baseForm,
    type ArtistTrack,
    type ExternalId,
    type ExternalLink,
    type SimilarArtist,
    type TrackEnrichment,
    type TrackRef,
} from '@deadair/plugin-sdk';

import { COVER_ART_ORIGIN } from './musicbrainz.manifest.js';
import {
    SOURCE_MUSICBRAINZ,
    SOURCE_MUSICBRAINZ_ARTIST,
    SOURCE_MUSICBRAINZ_RELEASE,
    SOURCE_MUSICBRAINZ_RELEASE_GROUP,
    webUrl,
} from './musicbrainz.mapping.js';
import type {
    ListenBrainzLookupQuery,
    ListenBrainzLookupResult,
    ListenBrainzRadioResponse,
    ListenBrainzRecordingMetadata,
    ListenBrainzRecordingMetadataResponse,
    ListenBrainzSimilarRecording,
    ListenBrainzTopRecording,
    ListenBrainzTag,
} from './listenbrainz.types.js';

/** Enough genres to characterise a track, few enough to say out loud. Matches the WS/2 mapping. */
const MAX_GENRES = 5;

/** How a ref is asked about. `release_name` is a hint, not a filter: it improves the match, never narrows it. */
export function toLookupQuery(ref: TrackRef): ListenBrainzLookupQuery {
    return { artist_name: ref.artist, recording_name: ref.title, ...(ref.album ? { release_name: ref.album } : {}) };
}

/**
 * The key a lookup result is filed under, so an answer can find its question.
 *
 * Built from the echoed `_arg` fields on the way back and from the ref itself
 * on the way out, compared in {@link baseForm} so a remaster suffix or a
 * punctuation difference between what was asked and what was echoed does not
 * lose the pairing. Position is never used: the service returns fewer entries
 * than it was asked about whenever something did not resolve.
 */
// `\u0000` as an escape rather than the literal byte it used to be: invisible in an editor and
// in a diff, so the same expression retyped elsewhere would build a different key and quietly
// never match. A NUL is still the right separator, since both halves are free text.
export const lookupKey = (artist: string, title: string): string => `${baseForm(artist)}\u0000${baseForm(title)}`;

export const resultKey = (result: ListenBrainzLookupResult): string =>
    lookupKey(result.artist_name_arg ?? result.artist_credit_name ?? '', result.recording_name_arg ?? result.recording_name ?? '');

/** The names out of a tag block, most-used first. A zero count is the community saying it does not apply. */
export function tagNames(tags: ListenBrainzTag[] | undefined): string[] {
    return (tags ?? [])
        .filter(tag => tag.tag && (tag.count ?? 1) > 0)
        .sort((left, right) => (right.count ?? 0) - (left.count ?? 0))
        .map(tag => tag.tag!)
        .slice(0, MAX_GENRES);
}

/**
 * The Cover Art Archive image for a release, minted rather than fetched.
 *
 * `caa_id` present is the answer to "is there a cover", exactly as
 * `cover-art-archive.front` is on a WS/2 release, so this costs no request and
 * the archive stays out of the manifest's allowlist. The id names the specific
 * image, which is why this addresses it directly instead of asking for `front`:
 * ListenBrainz already chose the front cover when it set `caa_id`.
 */
export function coverArtUrl(caaId: number | undefined, caaReleaseMbid: string | undefined): string | undefined {
    if (caaId === undefined || !caaReleaseMbid) return undefined;
    return `${COVER_ART_ORIGIN}/release/${caaReleaseMbid}/${caaId}-500.jpg`;
}

/**
 * One track's answer, from the lookup that identified it and the metadata that
 * described it.
 *
 * `metadata` is optional because the two steps can disagree: the lookup can
 * resolve a recording the metadata request then has nothing for. That is still
 * a good answer — the ids alone fill `tracks.mbid` and `artists.mbid` and turn
 * every later pass into a lookup — so it is returned rather than discarded.
 */
export function mapListenBrainz(
    result: ListenBrainzLookupResult,
    metadata: ListenBrainzRecordingMetadata | undefined,
    ref: TrackRef,
): Partial<TrackEnrichment> {
    if (!result.recording_mbid) return {};

    const enrichment: Partial<TrackEnrichment> = {};

    const artist = metadata?.artist?.name ?? result.artist_credit_name;
    if (artist) enrichment.artist = artist;

    const title = result.recording_name;
    if (title) enrichment.title = title;

    const album = metadata?.release?.name ?? result.release_name;
    if (album) enrichment.album = album;

    // A year and nothing finer. `releaseDate` is deliberately left unset rather
    // than padded out to January the first of it.
    const year = metadata?.release?.year;
    if (typeof year === 'number' && Number.isFinite(year)) enrichment.year = year;

    // The recording's own tags first, then the record's. The artist's are
    // deliberately not read: they are broader than the track's and would drown
    // the recording's in the merge, which is the same reason the WS/2 path asks
    // for no artist genres.
    const genres = tagNames(metadata?.tag?.recording);
    const names = genres.length > 0 ? genres : tagNames(metadata?.tag?.release_group);
    if (names.length > 0) enrichment.genres = names;

    const artwork = coverArtUrl(metadata?.release?.caa_id, metadata?.release?.caa_release_mbid);
    if (artwork) enrichment.artworkUrl = artwork;

    // The recording mbid identifies this answer whichever service returned it, so
    // a track described through ListenBrainz carries the same ref as one described
    // through WS/2.
    enrichment.providerRef = result.recording_mbid;

    const externalIds: ExternalId[] = [{ source: SOURCE_MUSICBRAINZ, id: result.recording_mbid }];
    const links: ExternalLink[] = [{ label: 'MusicBrainz recording', url: webUrl('recording', result.recording_mbid) }];

    const artistMbid = result.artist_mbids?.[0] ?? metadata?.artist?.artists?.[0]?.artist_mbid;
    if (artistMbid) {
        externalIds.push({ source: SOURCE_MUSICBRAINZ_ARTIST, id: artistMbid });
        links.push({ label: 'MusicBrainz artist', url: webUrl('artist', artistMbid) });
    }

    const releaseMbid = metadata?.release?.mbid ?? result.release_mbid;
    if (releaseMbid) externalIds.push({ source: SOURCE_MUSICBRAINZ_RELEASE, id: releaseMbid });

    // What fills `albums.mbid`, and therefore what turns the album pass's search
    // into a lookup. The single most valuable id in here after the recording's.
    const groupMbid = metadata?.release?.release_group_mbid;
    if (groupMbid) externalIds.push({ source: SOURCE_MUSICBRAINZ_RELEASE_GROUP, id: groupMbid });

    enrichment.externalIds = externalIds;
    enrichment.links = links;

    // The ISRC the provider already had, echoed back the way the WS/2 mapping
    // does, so a track described this way is not missing a field it could have
    // had for free.
    if (ref.isrc) enrichment.isrc = ref.isrc;

    return enrichment;
}

/**
 * The radio endpoint's answer as the host's shape: who else sounds like the
 * seed.
 *
 * Three things happen here and each is load-bearing.
 *
 * **The seed is dropped.** The endpoint includes the artist that was asked
 * about among its keys, because it is built to fill a station and a station
 * about an artist plays that artist. The host asked who ELSE resembles them,
 * and `SimilarityService` would otherwise dedupe the seed away after paying for
 * it — or, worse, keep it when the seed was reached by mbid and the name came
 * back spelled differently.
 *
 * **No `match`.** ListenBrainz orders its answer and publishes no similarity
 * score on this endpoint. `total_listen_count` is a popularity figure and not a
 * resemblance one, and passing it off as {@link SimilarArtist.match} would hand
 * the host a number it is entitled to compare against Last.fm's.
 *
 * **The mbid is kept**, because it crosses providers: it is the one identifier
 * in this shape that another plugin, or a later call to this one, can use
 * without guessing.
 */
export function toSimilarArtists(radio: ListenBrainzRadioResponse, seedMbid: string): SimilarArtist[] {
    const found: SimilarArtist[] = [];

    for (const [artistMbid, recordings] of Object.entries(radio)) {
        if (artistMbid === seedMbid) continue;

        const name = recordings.find(recording => recording.similar_artist_name?.trim())?.similar_artist_name?.trim();
        if (!name) continue;

        found.push({ name, mbid: artistMbid });
    }

    return found;
}

/**
 * An artist's top recordings as the host's shape.
 *
 * The rows arrive already ordered by listen count, so nothing here sorts them.
 *
 * The lead artist is `artist.artists[0]` from the metadata call, never the
 * row's own `artist_name`: that is the recording's artist CREDIT, so "Kalax
 * feat. Pyxis" would be a record named correctly and then dropped as one
 * nothing can find. A row whose metadata is missing is dropped rather than
 * guessed at, which is the same rule the Last.fm plugin applies to a record
 * with no artist of its own.
 */
export function toTopTracks(top: ListenBrainzTopRecording[], metadata: ListenBrainzRecordingMetadataResponse): ArtistTrack[] {
    const tracks: ArtistTrack[] = [];

    for (const row of top) {
        const recordingMbid = row.recording_mbid;
        if (!recordingMbid) continue;

        const found = metadata[recordingMbid];
        const title = row.recording_name?.trim() ?? found?.recording?.name?.trim();
        const artist = found?.artist?.artists?.[0]?.name?.trim();
        if (!title || !artist) continue;

        const album = row.release_name?.trim() ?? found?.release?.name?.trim();
        tracks.push({ title, artist, ...(album ? { album } : {}) });
    }

    return tracks;
}

/** The recording ids in a top-recordings answer, in the order given. */
export function topRecordingMbids(top: ListenBrainzTopRecording[]): string[] {
    return top.map(row => row.recording_mbid).filter((mbid): mbid is string => typeof mbid === 'string' && mbid.length > 0);
}

/**
 * Records that sound like one record, as the host's shape.
 *
 * Rows arrive highest score first and keep that order: `ArtistTrack` has
 * nowhere to put a score, and the host reads the order as the ranking.
 *
 * **The seed's own recording is dropped.** The endpoint answers about what is
 * listened to alongside the reference, and the reference is in its own
 * neighbourhood; `reference_mbid` echoes it, so it is recognised rather than
 * guessed at.
 *
 * The lead artist comes from `metadata`, never from `artist_credit_name`,
 * which is a credit line — and never from `artist_credit_mbids`, which came
 * back null on every row measured. A row with no lead is dropped rather than
 * given the anchor's artist: that would name a record by the wrong act, which
 * is the rule the Last.fm plugin applies at the same fork.
 */
export function toSimilarTracks(
    rows: ListenBrainzSimilarRecording[],
    seedMbid: string,
    metadata: ListenBrainzRecordingMetadataResponse,
): ArtistTrack[] {
    const tracks: ArtistTrack[] = [];

    for (const row of rows) {
        const recordingMbid = row.recording_mbid;
        if (!recordingMbid || recordingMbid === seedMbid) continue;

        const found = metadata[recordingMbid];
        const title = row.recording_name?.trim() ?? found?.recording?.name?.trim();
        const artist = found?.artist?.artists?.[0]?.name?.trim();
        if (!title || !artist) continue;

        const album = row.release_name?.trim() ?? found?.release?.name?.trim();
        tracks.push({ title, artist, ...(album ? { album } : {}) });
    }

    return tracks;
}

/** The recording ids in a similar-recordings answer, the seed excluded, in the order given. */
export function similarRecordingMbids(rows: ListenBrainzSimilarRecording[], seedMbid: string): string[] {
    return rows.map(row => row.recording_mbid).filter((mbid): mbid is string => typeof mbid === 'string' && mbid.length > 0 && mbid !== seedMbid);
}
