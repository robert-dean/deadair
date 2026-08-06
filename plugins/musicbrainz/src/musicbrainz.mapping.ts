/**
 * MusicBrainz entities to {@link TrackEnrichment} fields.
 *
 * What is missing here is missing on purpose. MusicBrainz is an identity and
 * relationship database, not a review site: it has no biography, no BPM, no
 * musical key and no mood vocabulary, so this plugin never sets `biography`,
 * `bpm`, `musicalKey` or `moods`. Those belong to a Last.fm or an AcousticBrainz
 * plugin sitting at a higher `priority` number, and inventing them here would
 * put guesses in front of the DJ under the name of the canonical source.
 */

import type { AlbumEnrichment, ExternalId, ExternalLink, TrackEnrichment, TrackRef } from '@deadair/plugin-sdk';

import { COVER_ART_ORIGIN, MUSICBRAINZ_WEB_ORIGIN } from './musicbrainz.manifest.js';
import { baseForm } from './musicbrainz.match.js';
import type { MusicBrainzRecording, MusicBrainzRelease, MusicBrainzReleaseGroup, MusicBrainzTag } from './musicbrainz.types.js';

/** Enough genres to characterise a track, few enough to say out loud. */
const MAX_GENRES = 5;

/** A release type that is the album a song came out on, rather than a later collection of it. */
const PREFERRED_RELEASE_TYPES = new Set(['album', 'ep', 'single']);

export const SOURCE_MUSICBRAINZ = 'musicbrainz';
export const SOURCE_MUSICBRAINZ_ARTIST = 'musicbrainz-artist';
export const SOURCE_MUSICBRAINZ_RELEASE = 'musicbrainz-release';

/** The record as a work, which is what `albums.mbid` holds. Not the pressing. */
export const SOURCE_MUSICBRAINZ_RELEASE_GROUP = 'musicbrainz-release-group';

/** The leading four digits of a MusicBrainz date, whatever precision it was given at. */
export function yearOf(date: string | undefined): number | undefined {
    const match = /^(\d{4})/.exec(date ?? '');
    if (!match) return undefined;
    const year = Number(match[1]);
    return Number.isFinite(year) ? year : undefined;
}

/**
 * The names out of a `genres` or `tags` block, most-used first.
 *
 * `genres` is the curated vocabulary and `tags` is whatever anyone typed, so
 * tags are only read when there are no genres at all. A zero count means the
 * votes for and against cancelled out, which is the community saying it does
 * not apply.
 */
export function tagNames(tags: MusicBrainzTag[] | undefined): string[] {
    return (tags ?? [])
        .filter(tag => tag.name && (tag.count ?? 1) > 0)
        .sort((left, right) => (right.count ?? 0) - (left.count ?? 0))
        .map(tag => tag.name!)
        .slice(0, MAX_GENRES);
}

/**
 * Which of a recording's releases to treat as *the* album.
 *
 * Preference order is the album the provider named, then the earliest official
 * album/EP/single, then simply the earliest. A recording that charted often
 * appears on dozens of releases, most of them compilations issued decades
 * later, and picking the wrong one gets the year, the label and the cover art
 * all wrong together.
 */
export function selectRelease(recording: MusicBrainzRecording, ref: TrackRef): MusicBrainzRelease | undefined {
    const releases = (recording.releases ?? []).filter(release => release.id);
    if (releases.length === 0) return undefined;

    if (ref.album) {
        const wanted = baseForm(ref.album);
        const named = releases.find(release => release.title && baseForm(release.title) === wanted);
        if (named) return named;
    }

    const preferred = releases.filter(release => PREFERRED_RELEASE_TYPES.has((release['release-group']?.['primary-type'] ?? '').toLowerCase()));
    return earliest(preferred.length > 0 ? preferred : releases);
}

/** When a release came out, in a form that sorts. `9999` puts an undated pressing last. */
const releaseOrder = (release: MusicBrainzRelease): string => release.date || release['release-group']?.['first-release-date'] || '9999';

const earliest = (releases: MusicBrainzRelease[]): MusicBrainzRelease | undefined =>
    [...releases].sort((left, right) => releaseOrder(left).localeCompare(releaseOrder(right)))[0];

/**
 * The pressing to read a label and a cover off, out of everything in a release
 * group.
 *
 * The earliest, which is the original issue: its label is the one that put the
 * record out, where a 2011 reissue's is whoever owns the catalogue now. Cover
 * art is the same story, and the original sleeve is the one people picture.
 */
export function selectReleaseFromGroup(group: MusicBrainzReleaseGroup | undefined): MusicBrainzRelease | undefined {
    return earliest((group?.releases ?? []).filter(release => release.id));
}

/** `https://musicbrainz.org/recording/<id>`, the page a human can read. */
export function webUrl(entity: string, mbid: string): string {
    return `${MUSICBRAINZ_WEB_ORIGIN}/${entity}/${mbid}`;
}

/**
 * The Cover Art Archive front cover for a release, when there is one.
 *
 * Minted rather than fetched. The archive's URL scheme is stable and the
 * release document already says whether a front cover exists, so this costs no
 * request and `coverartarchive.org` never has to appear in the manifest's
 * allowlist: the URL is for whoever renders it, not for this plugin to open.
 *
 * `front-500` rather than the full-size original, which is routinely several
 * megabytes of scanned gatefold.
 */
export function coverArtUrl(release: MusicBrainzRelease | undefined): string | undefined {
    if (!release?.id || release['cover-art-archive']?.front !== true) return undefined;
    return `${COVER_ART_ORIGIN}/release/${release.id}/front-500`;
}

/**
 * A release group and the pressing chosen out of it, as an `AlbumEnrichment`.
 *
 * The label and the cover belong here rather than on a track: a label issues a
 * record, and every track on it shares the answer. That is the whole reason
 * this is asked once per album — the same two facts used to cost one
 * `release/{id}` request per track on the record.
 *
 * `releaseDate` prefers the release group's first release over the chosen
 * pressing's own date, because the question a year answers is when the record
 * came out, and the copy in hand may well be a re-issue.
 */
export function mapAlbum(
    group: MusicBrainzReleaseGroup | undefined,
    release: MusicBrainzRelease | undefined,
    includeArtwork: boolean,
): Partial<AlbumEnrichment> {
    if (!group && !release) return {};

    const enrichment: Partial<AlbumEnrichment> = {};

    const title = group?.title ?? release?.title;
    if (title) enrichment.name = title;

    const credit = (group ?? release)?.['artist-credit']?.[0];
    const artist = credit?.artist?.name ?? credit?.name;
    if (artist) enrichment.artist = artist;

    const label = release?.['label-info']?.map(info => info.label?.name).find(name => name && name.length > 0);
    if (label) enrichment.label = label;

    const date = group?.['first-release-date'] || release?.date;
    if (date) {
        enrichment.releaseDate = date;
        const year = yearOf(date);
        if (year !== undefined) enrichment.year = year;
    }

    const genres = tagNames(group?.genres);
    const names = genres.length > 0 ? genres : tagNames(group?.tags);
    if (names.length > 0) enrichment.genres = names;

    if (includeArtwork) {
        const artwork = coverArtUrl(release);
        if (artwork) enrichment.artworkUrl = artwork;
    }

    // The release group first: it is what `albums.mbid` holds, and what the
    // host reads back as the id this answer was fetched under.
    const externalIds: ExternalId[] = [];
    const links: ExternalLink[] = [];
    if (group?.id) {
        externalIds.push({ source: SOURCE_MUSICBRAINZ_RELEASE_GROUP, id: group.id });
        links.push({ label: 'MusicBrainz release group', url: webUrl('release-group', group.id) });
    }
    if (release?.id) externalIds.push({ source: SOURCE_MUSICBRAINZ_RELEASE, id: release.id });

    if (externalIds.length > 0) enrichment.externalIds = externalIds;
    if (links.length > 0) enrichment.links = links;

    return enrichment;
}

/**
 * The recording half of an enrichment: everything that can be said from one
 * recording lookup and the release it points at, without a further request.
 *
 * Returns only what it actually resolved, per the SDK's contract, so a caller
 * can spread later contributions over it without a missing field from one
 * source blanking a present one from another.
 */
export function mapRecording(recording: MusicBrainzRecording, release: MusicBrainzRelease | undefined, ref: TrackRef): Partial<TrackEnrichment> {
    const enrichment: Partial<TrackEnrichment> = {};

    const credit = recording['artist-credit']?.[0];
    const artist = credit?.artist?.name ?? credit?.name;
    if (artist) enrichment.artist = artist;
    if (recording.title) enrichment.title = recording.title;
    if (release?.title) enrichment.album = release.title;

    // The recording's own first release, not the chosen release's date: the
    // question `year` answers is when the song came out, and the copy of it in
    // the catalog may well be a re-issue. The release falls in behind it only
    // as a fallback, for a recording MusicBrainz has no first release for.
    const firstRelease = recording['first-release-date'] || release?.['release-group']?.['first-release-date'] || release?.date;
    if (firstRelease) {
        enrichment.releaseDate = firstRelease;
        const year = yearOf(firstRelease);
        if (year !== undefined) enrichment.year = year;
    }

    const genres = tagNames(recording.genres);
    const names = genres.length > 0 ? genres : tagNames(recording.tags);
    if (names.length > 0) enrichment.genres = names;

    const isrc = recording.isrcs?.[0] ?? ref.isrc;
    if (isrc) enrichment.isrc = isrc;

    const externalIds: ExternalId[] = [];
    const links: ExternalLink[] = [];

    if (recording.id) {
        externalIds.push({ source: SOURCE_MUSICBRAINZ, id: recording.id });
        links.push({ label: 'MusicBrainz recording', url: webUrl('recording', recording.id) });
    }
    if (credit?.artist?.id) {
        externalIds.push({ source: SOURCE_MUSICBRAINZ_ARTIST, id: credit.artist.id });
        links.push({ label: 'MusicBrainz artist', url: webUrl('artist', credit.artist.id) });
    }
    if (release?.id) externalIds.push({ source: SOURCE_MUSICBRAINZ_RELEASE, id: release.id });
    // Free: `RECORDING_INC` already asks for release groups. This is what fills
    // `albums.mbid`, which is what turns the album pass's search into a lookup.
    const groupId = release?.['release-group']?.id;
    if (groupId) externalIds.push({ source: SOURCE_MUSICBRAINZ_RELEASE_GROUP, id: groupId });

    if (externalIds.length > 0) enrichment.externalIds = externalIds;
    if (links.length > 0) enrichment.links = links;

    return enrichment;
}
