import type { ProviderPlaylist, ProviderTrack } from '@deadair/plugin-sdk';

import { ARTWORK_SIZE, EXPLICIT_BADGE_ICON } from './ytmusic.manifest.js';

/**
 * The upstream shapes, as the library actually hands them over.
 *
 * Declared here rather than imported from `youtubei.js` on purpose: its parsed node classes are a
 * moving target across majors, and this plugin reads a handful of fields off them. A local
 * structural type says exactly which fields the mapping depends on, so a version bump that moves
 * one is a `tsc` failure here rather than an `undefined` in a `deadair.tracks` row.
 */
export interface UpstreamBadge {
    icon_type?: string;
    label?: string;
}

export interface UpstreamThumbnail {
    url: string;
    width?: number;
    height?: number;
}

export interface UpstreamArtist {
    name?: string;
    channel_id?: string;
}

export interface UpstreamItem {
    id?: string;
    item_type?: string;
    title?: string | { text?: string };
    duration?: { seconds?: number; text?: string };
    album?: { name?: string };
    artists?: UpstreamArtist[];
    badges?: UpstreamBadge[];
    year?: string | number;
    item_count?: string | number;
    subtitle?: string | { text?: string };
    thumbnails?: UpstreamThumbnail[];
    thumbnail?: { contents?: UpstreamThumbnail[] };
}

/** A title arrives as a bare string on search rows and as a `{ text }` node elsewhere. */
export const textOf = (value: string | { text?: string } | undefined): string | undefined => {
    if (typeof value === 'string') return value.trim() || undefined;
    const text = value?.text?.trim();
    return text || undefined;
};

/**
 * One stable artwork URL per record.
 *
 * Thumbnails arrive at several sizes and the size is written INTO the url, after a `=`
 * (`…=w120-h120-l90-rj`). Taking "the largest" therefore yields a different string depending on
 * which sizes this particular response happened to carry, and the SDK's rule is that a URL handed
 * back to be STORED must be stable: the host keeps it on the row and the art cache is keyed by the
 * string, so a part that varies means the same cover is fetched again forever. Cutting at the `=`
 * and appending one fixed suffix makes one record one URL. `resolveStreamUrl` is exempt from that
 * rule; this is not, and this plugin has no `resolveStreamUrl` anyway.
 */
export function artworkUrl(item: UpstreamItem): string | undefined {
    const candidates = item.thumbnails ?? item.thumbnail?.contents ?? [];
    const raw = candidates[0]?.url;
    if (!raw) return undefined;

    const base = raw.split('=')[0];
    if (!base || !/^https?:\/\//i.test(base)) return undefined;
    return `${base}=${ARTWORK_SIZE}`;
}

/**
 * The advisory this copy carries, or nothing.
 *
 * `icon_type` and never `label`: the label is the localized word, so an account in any other
 * language would carry the badge and never match it. A badge that quietly stops firing is worse
 * than no badge at all here, because `rotation.advisory` set to clean-only has to demand a positive
 * `'clean'`, and a station would then be airing explicit records believing it had filtered them.
 *
 * Never `'clean'`. The absence of an explicit badge is the provider not marking this copy, which is
 * not the same as the provider saying it is clean, and the SDK is explicit that treating silence as
 * consent is how a station promises something it cannot deliver.
 */
export const advisoryOf = (item: UpstreamItem): 'explicit' | undefined =>
    (item.badges ?? []).some(badge => badge?.icon_type === EXPLICIT_BADGE_ICON) ? 'explicit' : undefined;

/**
 * A search or playlist row as a `ProviderTrack`, or nothing when it is not a playable record.
 *
 * `artists` is copied straight across, and that is safe here in a way it would not be against every
 * provider: this source names only the LEAD on a collaboration and leaves the other credits in the
 * title ("Love The Way You Lie (feat. Rihanna)" arrives with `artists: [Eminem]`). The rule it has
 * to satisfy is that `artists[0]` is the identity rather than a credit line, because
 * `PickResolver.identify` keys off `normalizeKey(track.artists[0])` and a joined credit there is
 * how a live run named every duet correctly and then dropped every one of them as "not in the
 * catalog".
 *
 * Four fields this provider never sets, each of which must read as "did not say" rather than as a
 * value: `isrc` (it publishes none, which makes these rows second-class for cross-provider dedupe
 * and for the MusicBrainz enrichment path), `year` (absent from search rows, and an absent year is
 * correctly ELIGIBLE for a period filter rather than excluded), `popularity` (no such number, and
 * absent reads as "no opinion" rather than "unpopular"), and `advisory` when unbadged.
 */
export function mapTrack(item: UpstreamItem | undefined): ProviderTrack | undefined {
    if (!item?.id) return undefined;

    const title = textOf(item.title);
    if (!title) return undefined;

    const artists = (item.artists ?? []).map(artist => artist?.name?.trim()).filter((name): name is string => !!name);

    const seconds = item.duration?.seconds;
    const album = item.album?.name?.trim();
    const artwork = artworkUrl(item);
    const advisory = advisoryOf(item);

    return {
        id: item.id,
        title,
        artists,
        ...(album ? { album } : {}),
        ...(typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? { durationMs: Math.round(seconds * 1000) } : {}),
        ...(artwork ? { artworkUrl: artwork } : {}),
        ...(advisory ? { advisory } : {}),
    };
}

/** Every row that is a record, in the order the provider gave them. */
export const mapTracks = (items: readonly (UpstreamItem | undefined)[] | undefined): ProviderTrack[] =>
    (items ?? []).map(mapTrack).filter((track): track is ProviderTrack => track !== undefined);

const countOf = (value: string | number | undefined): number | undefined => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    const digits = value?.match(/\d[\d,]*/)?.[0]?.replace(/,/g, '');
    return digits ? Number(digits) : undefined;
};

/**
 * A library row as a `ProviderPlaylist`, or nothing when the row is not a playlist at all.
 *
 * That last clause is the point of the guard. The library's Playlists view is not a list of
 * playlists: it also carries a "New playlist" BUTTON, which parses as an item with
 * `item_type: 'endpoint'` and no id. Mapped blindly it becomes a `ProviderPlaylist` whose `id` is
 * `undefined`, which the host then stores and later asks this plugin to read.
 *
 * Dropping it is not the thing the SDK forbids. "Never leave a playlist out of a page" exists
 * because the host reads a short page as the end of the list, so a real playlist omitted takes
 * every playlist after it down too. This row was never a playlist.
 */
export function mapPlaylist(item: UpstreamItem | undefined): ProviderPlaylist | undefined {
    if (!item?.id || item.item_type !== 'playlist') return undefined;

    const name = textOf(item.title);
    if (!name) return undefined;

    const description = textOf(item.subtitle);
    const trackCount = countOf(item.item_count);
    const artwork = artworkUrl(item);

    return {
        id: item.id,
        name,
        ...(description ? { description } : {}),
        ...(trackCount !== undefined ? { trackCount } : {}),
        ...(artwork ? { artworkUrl: artwork } : {}),
    };
}

/** Every row that is a playlist, in the order the provider gave them. */
export const mapPlaylists = (items: readonly (UpstreamItem | undefined)[] | undefined): ProviderPlaylist[] =>
    (items ?? []).map(mapPlaylist).filter((playlist): playlist is ProviderPlaylist => playlist !== undefined);
