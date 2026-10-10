import { DateTime } from 'luxon';
const __dt = (v: unknown, path: string): DateTime => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected an ISO 8601 string at '${path}', received ${typeof v}.`);
    }
    const d = DateTime.fromISO(v);
    if (!d.isValid) throw new TypeError(`ContractKit: '${v}' at '${path}' is not a valid ISO 8601 datetime.`);
    return d;
};

/**
 * An action a source will permit on one playlist's items. Item-scoped: neither value covers the playlist's own name or description
 * generated from [PlaylistPermission](../../../../../apps/api/data/contracts/playlists/playlists.types.ck)
 */
export type PlaylistPermission = 'read' | 'edit';

/**
 * One record as its PROVIDER describes it, plus what the catalog can say about the same copy.
 *
 * The first half mirrors the plugin SDK's `ProviderTrack` and stays the provider's answer: this is a
 * listing of what a playlist holds, not of what the station has ingested. The three ids below are the
 * station's own and are absent for anything it has never seen, which on most playlists is plenty of
 * rows — a playlist is a provider's list and the library is what a sync has walked
 * generated from [CatalogTrack](../../../../../apps/api/data/contracts/playlists/playlists.types.ck)
 */
export interface CatalogTrack {
    /** The PROVIDER's id for this copy, which is what an import names it by. Never a `deadair.tracks` id */
    id: string;
    title: string;
    /** Ordered, primary artist first. Empty array if the provider genuinely has none */
    artists: string[];
    album?: string;
    durationMs?: number;
    isrc?: string;
    artworkUrl?: string;
    /** The canonical `deadair.tracks` row this copy is bound to, when the catalog holds one */
    trackId?: string;
    /** The canonical artist behind that row */
    artistId?: string;
    /** The release that row was ingested inside. Absent for a single ingested outside any */
    albumId?: string;
}

/**
 * One catalog-capable plugin that could not be listed
 * generated from [CatalogSourceError](../../../../../apps/api/data/contracts/playlists/playlists.types.ck)
 */
export interface CatalogSourceError {
    pluginId: string;
    pluginName: string;
    message: string;
}

/**
 * One music source whose playlists are in this answer, and how old its list is
 * generated from [CatalogPlaylistSource](../../../../../apps/api/data/contracts/playlists/playlists.types.ck)
 */
export interface CatalogPlaylistSource {
    pluginId: string;
    pluginName: string;
    /** When the station last read this source's whole list of playlists. The library sync reads it in the background, so this is usually minutes old; a source listed for the first time is read for this answer */
    listedAt: DateTime;
}

/** Rehydrates every wire-encoded scalar in a CatalogPlaylistSource into its runtime type. Mutates and returns `raw`. */
export function reviveCatalogPlaylistSource(raw: CatalogPlaylistSource): CatalogPlaylistSource {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['listedAt'] = __dt(__o0['listedAt'], 'CatalogPlaylistSource.listedAt');
    return raw;
}

/**
 * A playlist a catalog-capable plugin offers, tagged with the plugin it came from so an aggregated list is addressable
 * generated from [CatalogPlaylist](../../../../../apps/api/data/contracts/playlists/playlists.types.ck)
 */
export interface CatalogPlaylist {
    pluginId: string;
    pluginName: string;
    id: string;
    name: string;
    description?: string;
    trackCount?: number;
    artworkUrl?: string;
    /** What the SOURCE permits on this playlist's items, not what this actor may do. Empty means the source permits nothing; absent means it did not say */
    permissions?: PlaylistPermission[];
    /** The source made this playlist itself rather than a person: an editorial list, or one generated for the account like Discover Weekly. Absent when it did not say */
    madeByProvider?: boolean;
    /** An operator hid this playlist from this station, so pickers leave it out and the library sync does not read it. Absent when it is not hidden */
    hidden?: boolean;
}

/**
 * generated from [CatalogPlaylistTracks](../../../../../apps/api/data/contracts/playlists/playlists.types.ck)
 */
export interface CatalogPlaylistTracks {
    pluginId: string;
    playlistId: string;
    tracks: CatalogTrack[];
}

/**
 * generated from [CatalogPlaylistPage](../../../../../apps/api/data/contracts/playlists/playlists.types.ck)
 */
export interface CatalogPlaylistPage {
    playlists: CatalogPlaylist[];
    /** Every source whose playlists are listed, including one that also has an entry in `errors`: its list is then the last one the station read. Absent from a station that predates it, which asked every source live */
    sources?: CatalogPlaylistSource[];
    errors: CatalogSourceError[];
}

/** Rehydrates every wire-encoded scalar in a CatalogPlaylistPage into its runtime type. Mutates and returns `raw`. */
export function reviveCatalogPlaylistPage(raw: CatalogPlaylistPage): CatalogPlaylistPage {
    const __o0 = raw as unknown as Record<string, unknown>;
    if (__o0['sources'] != null) {
        {
            const __a1 = __o0['sources'] as unknown[];
            for (let __i2 = 0; __i2 < __a1.length; __i2++) {
                reviveCatalogPlaylistSource(__a1[__i2] as never);
            }
        }
    }
    return raw;
}
