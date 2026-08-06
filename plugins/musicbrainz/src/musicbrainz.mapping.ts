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

import type { ExternalId, ExternalLink, TrackEnrichment, TrackRef } from '@deadair/plugin-sdk';

import { COVER_ART_ORIGIN, MUSICBRAINZ_WEB_ORIGIN } from './musicbrainz.manifest.js';
import { baseForm } from './musicbrainz.match.js';
import type { MusicBrainzRecording, MusicBrainzRelease, MusicBrainzTag } from './musicbrainz.types.js';

/** Enough genres to characterise a track, few enough to say out loud. */
const MAX_GENRES = 5;

/** A release type that is the album a song came out on, rather than a later collection of it. */
const PREFERRED_RELEASE_TYPES = new Set(['album', 'ep', 'single']);

export const SOURCE_MUSICBRAINZ = 'musicbrainz';
export const SOURCE_MUSICBRAINZ_ARTIST = 'musicbrainz-artist';
export const SOURCE_MUSICBRAINZ_RELEASE = 'musicbrainz-release';

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

    const order = (release: MusicBrainzRelease): string => release.date || release['release-group']?.['first-release-date'] || '9999';
    const preferred = releases.filter(release => PREFERRED_RELEASE_TYPES.has((release['release-group']?.['primary-type'] ?? '').toLowerCase()));
    const pool = preferred.length > 0 ? preferred : releases;

    return [...pool].sort((left, right) => order(left).localeCompare(order(right)))[0];
}

/** The fields that accumulate across contributions instead of being decided by one of them. */
const LIST_FIELDS = ['genres', 'moods', 'facts', 'externalIds', 'links'] as const;

/** How to tell two entries in a list field apart. Anything without one is compared by value. */
const identity = (value: unknown): string => {
    if (typeof value === 'string') return value;
    const record = value as { source?: string; id?: string; url?: string };
    if (record.url) return record.url;
    if (record.source && record.id) return `${record.source}:${record.id}`;
    return JSON.stringify(value);
};

/**
 * Combines this plugin's own contributions into one enrichment, most
 * authoritative first.
 *
 * Not the same operation the host performs across plugins, and it should not
 * be: within one plugin the recording, its release and its artist are three
 * views of the same match, so scalars are decided by whichever view is closest
 * to the question (the recording knows the year; the release knows the label)
 * while the lists are additive. Spreading these objects instead would let the
 * artist's `links` silently replace the recording's.
 */
export function mergeEnrichment(...parts: Partial<TrackEnrichment>[]): Partial<TrackEnrichment> {
    const merged: Partial<TrackEnrichment> = {};
    const lists = new Map<string, { seen: Set<string>; values: unknown[] }>();

    for (const part of parts) {
        for (const [key, value] of Object.entries(part)) {
            if (value === undefined) continue;

            if ((LIST_FIELDS as readonly string[]).includes(key)) {
                const list = lists.get(key) ?? { seen: new Set<string>(), values: [] };
                for (const entry of value as unknown[]) {
                    const marker = identity(entry);
                    if (list.seen.has(marker)) continue;
                    list.seen.add(marker);
                    list.values.push(entry);
                }
                lists.set(key, list);
                continue;
            }

            // First writer wins: the parts arrive in priority order.
            if (!(key in merged)) Object.assign(merged, { [key]: value });
        }
    }

    for (const [key, list] of lists) {
        if (list.values.length > 0) Object.assign(merged, { [key]: list.values });
    }

    return merged;
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
 * The release half of an enrichment: what the recording document could not
 * answer without a second lookup.
 *
 * `releaseDate` is here as a fallback only. The date that matters is the
 * recording's first release, and the caller layers this underneath
 * {@link mapRecording} so this one fills the gap rather than overwriting it:
 * for a track whose recording has no first-release-date, the date of the
 * release it was found on is a better answer than nothing.
 */
export function mapRelease(release: MusicBrainzRelease | undefined, includeArtwork: boolean): Partial<TrackEnrichment> {
    if (!release) return {};

    const enrichment: Partial<TrackEnrichment> = {};

    const label = release['label-info']?.map(info => info.label?.name).find(name => name && name.length > 0);
    if (label) enrichment.label = label;

    if (release.date) {
        enrichment.releaseDate = release.date;
        const year = yearOf(release.date);
        if (year !== undefined) enrichment.year = year;
    }

    if (includeArtwork) {
        const artwork = coverArtUrl(release);
        if (artwork) enrichment.artworkUrl = artwork;
    }

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
    // the catalog may well be a re-issue.
    const firstRelease = recording['first-release-date'];
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

    if (externalIds.length > 0) enrichment.externalIds = externalIds;
    if (links.length > 0) enrichment.links = links;

    return enrichment;
}
