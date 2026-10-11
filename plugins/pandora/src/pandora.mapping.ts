import type { ProviderPlaylist, ProviderTrack } from '@deadair/plugin-sdk';

/** Where an annotation's relative `artUrl` lives. */
const ART_ORIGIN = 'https://content-images.p-cdn.com/';

/**
 * One object as `annotateObjects` and search describe it. Every Pandora object is one of these,
 * told apart by the prefix of its `pandoraId` (`TR:`, `AL:`, `AR:`, `PL:`). Only the fields read here
 * are typed, and all of them are optional, because this is somebody else's undocumented API.
 */
export interface PandoraAnnotation {
    pandoraId?: string;
    type?: string;
    name?: string;
    /** Seconds. */
    duration?: number;
    durationMillis?: number;
    trackNumber?: number;
    albumId?: string;
    albumName?: string;
    artistName?: string;
    isrc?: string;
    /** `NONE`, `EXPLICIT` or `CLEAN`. */
    explicitness?: string;
    icon?: { artUrl?: string };
    /** An album's. ISO-8601. */
    releaseDate?: string;
    /** A playlist's. */
    totalTracks?: number;
    description?: string;
    /** A playlist's own artwork when it has no single icon. */
    thorLayers?: string;
    rightsInfo?: { hasInteractive?: boolean };
}

export type PandoraAnnotations = Record<string, PandoraAnnotation | undefined>;

/** `annotateObjects` answers either with the map itself or with it under `annotations`. */
export function annotationsOf(body: unknown): PandoraAnnotations {
    if (body === null || typeof body !== 'object') return {};
    const wrapped = (body as { annotations?: unknown }).annotations;
    return (wrapped !== null && typeof wrapped === 'object' ? wrapped : body) as PandoraAnnotations;
}

const advisoryOf = (explicitness: string | undefined): ProviderTrack['advisory'] =>
    explicitness === 'EXPLICIT' ? 'explicit' : explicitness === 'CLEAN' ? 'clean' : undefined;

const artOf = (annotation: PandoraAnnotation | undefined): string | undefined =>
    annotation?.icon?.artUrl ? `${ART_ORIGIN}${annotation.icon.artUrl.replace(/^\//, '')}` : undefined;

const yearOf = (iso: string | undefined): number | undefined => {
    const year = iso === undefined ? Number.NaN : Number(iso.slice(0, 4));
    return Number.isInteger(year) && year > 0 ? year : undefined;
};

/**
 * A track annotation as the station's `ProviderTrack`, or `undefined` when it is not a track or lacks
 * what one needs. The album's annotation, when the same answer carried it, supplies the year.
 */
export function mapTrack(id: string, annotations: PandoraAnnotations): ProviderTrack | undefined {
    const track = annotations[id];
    if (track === undefined || !id.startsWith('TR:') || !track.name) return undefined;

    const album = track.albumId === undefined ? undefined : annotations[track.albumId];
    const durationMs = track.durationMillis ?? (track.duration === undefined ? undefined : track.duration * 1000);
    const advisory = advisoryOf(track.explicitness);
    const artworkUrl = artOf(track) ?? artOf(album);
    const year = yearOf(album?.releaseDate);

    return {
        id,
        title: track.name,
        artists: track.artistName ? [track.artistName] : [],
        ...(track.albumName ? { album: track.albumName } : {}),
        ...(durationMs === undefined ? {} : { durationMs }),
        ...(track.isrc ? { isrc: track.isrc } : {}),
        ...(artworkUrl === undefined ? {} : { artworkUrl }),
        ...(year === undefined ? {} : { year }),
        ...(track.trackNumber === undefined ? {} : { trackNumber: track.trackNumber }),
        ...(advisory === undefined ? {} : { advisory }),
    };
}

/** Every track among `ids` that maps, in the order given. */
export function mapTracks(ids: readonly string[], annotations: PandoraAnnotations): ProviderTrack[] {
    return ids.map(id => mapTrack(id, annotations)).filter((track): track is ProviderTrack => track !== undefined);
}

/**
 * A playlist annotation as the station's `ProviderPlaylist`.
 *
 * A playlist an account lists is one it can read; whether it may edit it is not something this plugin
 * ever asks Pandora, so `permissions` says only what is known.
 */
export function mapPlaylist(id: string, annotation: PandoraAnnotation | undefined, name?: string): ProviderPlaylist {
    const artworkUrl = artOf(annotation);
    return {
        id,
        name: annotation?.name ?? name ?? id,
        ...(annotation?.description ? { description: annotation.description } : {}),
        ...(annotation?.totalTracks === undefined ? {} : { trackCount: annotation.totalTracks }),
        ...(artworkUrl === undefined ? {} : { artworkUrl }),
        permissions: ['read'],
    };
}

/** A Pandora playlist id: `PL:` then two numbers, the owner's and the list's. */
const PLAYLIST_ID = /PL:\d+:\d+/;

/**
 * The playlist id a pasted Pandora link names, or `undefined` for anything that is not one.
 *
 * A pure parse, as the SDK requires. Pandora's links put the id in the path, either raw
 * (`/playlist/PL:1:2`) or percent-encoded, so the path is decoded before it is read.
 */
export function pandoraPlaylistIdFromUrl(url: string): string | undefined {
    let parsed: URL;
    try {
        parsed = new URL(url.trim());
    } catch {
        return undefined;
    }
    if (parsed.hostname !== 'pandora.com' && !parsed.hostname.endsWith('.pandora.com')) return undefined;

    let path: string;
    try {
        path = decodeURIComponent(parsed.pathname);
    } catch {
        return undefined;
    }
    if (!path.startsWith('/playlist/')) return undefined;

    return PLAYLIST_ID.exec(path)?.[0];
}
