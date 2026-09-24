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
 * A playlist the station owns: records it holds in its own library, in an order somebody chose, cloned
 * from somewhere else and free to differ from it afterwards
 * generated from [StationPlaylist](../../../../../apps/api/data/contracts/playlists/station.playlists.types.ck#L9)
 */
export interface StationPlaylist {
    id: string;
    name: string;
    /** What this playlist is for, in the operator's own words. Empty when nobody said */
    prompt: string;
    /** The plugin this was cloned from, for a badge and nothing else. Absent for one read from a file or made here */
    originPluginId?: string;
    /** Every row, placeholders included */
    trackCount: number;
    /** The rows that name a record in the library, which are the ones that can air */
    resolvedCount: number;
    createdAt: DateTime;
    updatedAt: DateTime;
}

export interface StationPlaylistInput {
    name: string;
    /** What this playlist is for, in the operator's own words. Empty when nobody said */
    prompt: string;
}

/** Rehydrates every wire-encoded scalar in a StationPlaylist into its runtime type. Mutates and returns `raw`. */
export function reviveStationPlaylist(raw: StationPlaylist): StationPlaylist {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['createdAt'] = __dt(__o0['createdAt'], 'StationPlaylist.createdAt');
    __o0['updatedAt'] = __dt(__o0['updatedAt'], 'StationPlaylist.updatedAt');
    return raw;
}

/**
 * One row of a station playlist: a record in the library, or a placeholder for one it does not hold yet
 * generated from [StationPlaylistTrack](../../../../../apps/api/data/contracts/playlists/station.playlists.types.ck#L25)
 */
export interface StationPlaylistTrack {
    /** The row's own id, not the record's */
    id: string;
    position: number;
    title: string;
    /** Ordered, primary artist first */
    artists: string[];
    album?: string;
    durationMs?: number;
    /** The library record this row plays. Absent on a placeholder */
    trackId?: string;
    artistId?: string;
    albumId?: string;
    /** On a placeholder, the plugin whose copy it was cloned from. Absent on one read from a file, which names a record and no copy of it */
    originPluginId?: string;
}

/**
 * What may change about a station playlist after it exists. Absent fields are left alone
 * generated from [StationPlaylistUpdate](../../../../../apps/api/data/contracts/playlists/station.playlists.types.ck#L43)
 */
export interface StationPlaylistUpdate {
    name?: string;
    prompt?: string;
}

/**
 * Where a record in a file came from, when it came from a provider's copy. Carried so a record the
 * receiving library does not hold can still be matched by that copy later
 * generated from [PlaylistFileOrigin](../../../../../apps/api/data/contracts/playlists/station.playlists.types.ck#L50)
 */
export interface PlaylistFileOrigin {
    pluginId: string;
    externalId: string;
}

/**
 * A playlist one of the station's music sources holds, named the way the playlists listing names it
 * generated from [PlaylistProviderRef](../../../../../apps/api/data/contracts/playlists/station.playlists.types.ck#L77)
 */
export interface PlaylistProviderRef {
    pluginId: string;
    playlistId: string;
}

/**
 * What importing one record would do here
 * generated from [PlaylistImportEntry](../../../../../apps/api/data/contracts/playlists/station.playlists.types.ck#L94)
 */
export interface PlaylistImportEntry {
    position: number;
    title: string;
    artists: string[];
    /** `matched`: the library holds it. `toAdd`: it names a provider's copy, which the station can add to its library. `toLookUp`: it names only a record, which the station has to search its providers for */
    outcome: 'matched' | 'toAdd' | 'toLookUp';
    /** The library record a `matched` row plays */
    trackId?: string;
}

/**
 * generated from [StationPlaylistList](../../../../../apps/api/data/contracts/playlists/station.playlists.types.ck#L20)
 */
export interface StationPlaylistList {
    playlists: StationPlaylist[];
}

export interface StationPlaylistListInput {
    playlists: StationPlaylistInput[];
}

/** Rehydrates every wire-encoded scalar in a StationPlaylistList into its runtime type. Mutates and returns `raw`. */
export function reviveStationPlaylistList(raw: StationPlaylistList): StationPlaylistList {
    const __o0 = raw as unknown as Record<string, unknown>;
    {
        const __a1 = __o0['playlists'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveStationPlaylist(__a1[__i2] as never);
        }
    }
    return raw;
}

/**
 * generated from [StationPlaylistDetail](../../../../../apps/api/data/contracts/playlists/station.playlists.types.ck#L38)
 */
export interface StationPlaylistDetail extends StationPlaylist {
    tracks: StationPlaylistTrack[];
}

export interface StationPlaylistDetailInput extends StationPlaylistInput {
    tracks: StationPlaylistTrack[];
}

/** Rehydrates every wire-encoded scalar in a StationPlaylistDetail into its runtime type. Mutates and returns `raw`. */
export function reviveStationPlaylistDetail(raw: StationPlaylistDetail): StationPlaylistDetail {
    reviveStationPlaylist(raw as never);
    return raw;
}

/**
 * One record as a playlist file names it. By its words and its ISRC, never by an id of this station's:
 * ids are minted afresh by every library, so a file keyed by them would restore onto nothing
 * generated from [PlaylistFileTrack](../../../../../apps/api/data/contracts/playlists/station.playlists.types.ck#L57)
 */
export interface PlaylistFileTrack {
    title: string;
    /** Ordered, primary artist first */
    artists: string[];
    album?: string;
    durationMs?: number;
    isrc?: string;
    origin?: PlaylistFileOrigin;
}

/**
 * What an import WOULD do, written nowhere
 * generated from [PlaylistImportPlan](../../../../../apps/api/data/contracts/playlists/station.playlists.types.ck#L107)
 */
export interface PlaylistImportPlan {
    name: string;
    matched: number;
    toAdd: number;
    toLookUp: number;
    /** Lines of the source that named no record the station could read */
    skipped: number;
    entries: PlaylistImportEntry[];
    /** Anything about the source as a whole an operator should know before importing it */
    notices: string[];
}

/**
 * A playlist as a file: everything somebody would need to rebuild it on another station
 * generated from [PlaylistFile](../../../../../apps/api/data/contracts/playlists/station.playlists.types.ck#L67)
 */
export interface PlaylistFile {
    /** What shape this is, so a file from a later build says so rather than being read wrongly */
    format: string;
    /** When it was exported, ISO-8601 */
    takenAt: string;
    /** The station it was taken from. Provenance only */
    station?: string;
    name: string;
    prompt?: string;
    tracks: PlaylistFileTrack[];
}

/**
 * generated from [PlaylistImportResult](../../../../../apps/api/data/contracts/playlists/station.playlists.types.ck#L117)
 */
export interface PlaylistImportResult {
    plan: PlaylistImportPlan;
    playlist: StationPlaylist;
}

export interface PlaylistImportResultInput {
    plan: PlaylistImportPlan;
    playlist: StationPlaylistInput;
}

/** Rehydrates every wire-encoded scalar in a PlaylistImportResult into its runtime type. Mutates and returns `raw`. */
export function revivePlaylistImportResult(raw: PlaylistImportResult): PlaylistImportResult {
    const __o0 = raw as unknown as Record<string, unknown>;
    reviveStationPlaylist(__o0['playlist'] as never);
    return raw;
}

/**
 * Something to import a playlist from. Exactly one source
 * generated from [PlaylistImportInput](../../../../../apps/api/data/contracts/playlists/station.playlists.types.ck#L83)
 */
export interface PlaylistImportInput {
    /** A playlist exported from a deadair station */
    file?: PlaylistFile;
    /** A playlist another program wrote, as its text: an M3U, a CSV with a header row, or one `Artist - Title` per line */
    text?: string;
    /** Which of those `text` is. Absent works it out from the text */
    format?: 'm3u' | 'csv' | 'text';
    /** The name of the file `text` came from, which names the playlist when the text does not */
    fileName?: string;
    /** A link to a playlist at one of the station's music sources, as a browser or an app shows it */
    url?: string;
    /** A playlist a music source lists here, by its plugin and its id */
    providerPlaylist?: PlaylistProviderRef;
    /** What to call the new playlist. Absent keeps the name the source gives it */
    name?: string;
}
