import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * A playlist the station owns: records it holds in its own library, in an order somebody chose, cloned
 * from somewhere else and free to differ from it afterwards
 * generated from [StationPlaylist](../../../../data/contracts/playlists/station.playlists.types.ck#L9)
 */
export const StationPlaylist = z.strictObject({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(200),
    prompt: z.string().max(4000).describe("What this playlist is for, in the operator's own words. Empty when nobody said"),
    originPluginId: z
        .string()
        .max(200)
        .optional()
        .describe('The plugin this was cloned from, for a badge and nothing else. Absent for one read from a file or made here'),
    trackCount: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe('Every row, placeholders included'),
    resolvedCount: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe('The rows that name a record in the library, which are the ones that can air'),
    createdAt: _ZodDatetime,
    updatedAt: _ZodDatetime,
});
export type StationPlaylist = z.infer<typeof StationPlaylist>;

export const StationPlaylistInput = z.strictObject({
    name: z.string().min(1).max(200),
    prompt: z.string().max(4000).describe("What this playlist is for, in the operator's own words. Empty when nobody said"),
});
export type StationPlaylistInput = z.infer<typeof StationPlaylistInput>;

/**
 * One row of a station playlist: a record in the library, or a placeholder for one it does not hold yet
 * generated from [StationPlaylistTrack](../../../../data/contracts/playlists/station.playlists.types.ck#L25)
 */
export const StationPlaylistTrack = z.strictObject({
    id: z.string().min(1).max(100).describe("The row's own id, not the record's"),
    position: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0)),
    title: z.string().min(1).max(400),
    artists: z.array(z.string().min(1).max(200)).describe('Ordered, primary artist first'),
    album: z.string().max(400).optional(),
    durationMs: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0)).optional(),
    trackId: z.string().max(100).optional().describe('The library record this row plays. Absent on a placeholder'),
    artistId: z.string().max(100).optional(),
    albumId: z.string().max(100).optional(),
    originPluginId: z
        .string()
        .max(200)
        .optional()
        .describe(
            'On a placeholder, the plugin whose copy it was cloned from. Absent on one read from a file, which names a record and no copy of it',
        ),
});
export type StationPlaylistTrack = z.infer<typeof StationPlaylistTrack>;

/**
 * What may change about a station playlist after it exists. Absent fields are left alone
 * generated from [StationPlaylistUpdate](../../../../data/contracts/playlists/station.playlists.types.ck#L43)
 */
export const StationPlaylistUpdate = z.strictObject({
    name: z.string().min(1).max(200).optional(),
    prompt: z.string().max(4000).optional(),
});
export type StationPlaylistUpdate = z.infer<typeof StationPlaylistUpdate>;

/**
 * Where a record in a file came from, when it came from a provider's copy. Carried so a record the
 * receiving library does not hold can still be matched by that copy later
 * generated from [PlaylistFileOrigin](../../../../data/contracts/playlists/station.playlists.types.ck#L50)
 */
export const PlaylistFileOrigin = z.strictObject({
    pluginId: z.string().min(1).max(200),
    externalId: z.string().min(1).max(400),
});
export type PlaylistFileOrigin = z.infer<typeof PlaylistFileOrigin>;

/**
 * A playlist one of the station's music sources holds, named the way the playlists listing names it
 * generated from [PlaylistProviderRef](../../../../data/contracts/playlists/station.playlists.types.ck#L77)
 */
export const PlaylistProviderRef = z.strictObject({
    pluginId: z.string().min(1).max(200),
    playlistId: z.string().min(1).max(400),
});
export type PlaylistProviderRef = z.infer<typeof PlaylistProviderRef>;

/**
 * What importing one record would do here
 * generated from [PlaylistImportEntry](../../../../data/contracts/playlists/station.playlists.types.ck#L94)
 */
export const PlaylistImportEntry = z.strictObject({
    position: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0)),
    title: z.string().min(1).max(400),
    artists: z.array(z.string().min(1).max(200)),
    outcome: z
        .enum(['matched', 'toAdd', 'toLookUp'])
        .describe(
            "`matched`: the library holds it. `toAdd`: it names a provider's copy, which the station can add to its library. `toLookUp`: it names only a record, which the station has to search its providers for",
        ),
    trackId: z.string().max(100).optional().describe('The library record a `matched` row plays'),
});
export type PlaylistImportEntry = z.infer<typeof PlaylistImportEntry>;

/**
 * generated from [StationPlaylistList](../../../../data/contracts/playlists/station.playlists.types.ck#L20)
 */
export const StationPlaylistList = z.strictObject({
    playlists: z.array(StationPlaylist),
});
export type StationPlaylistList = z.infer<typeof StationPlaylistList>;

export const StationPlaylistListInput = z.strictObject({
    playlists: z.array(StationPlaylistInput),
});
export type StationPlaylistListInput = z.infer<typeof StationPlaylistListInput>;

/**
 * generated from [StationPlaylistDetail](../../../../data/contracts/playlists/station.playlists.types.ck#L38)
 */
export const StationPlaylistDetail = StationPlaylist.extend({
    tracks: z.array(StationPlaylistTrack),
});
export type StationPlaylistDetail = z.infer<typeof StationPlaylistDetail>;

export const StationPlaylistDetailInput = StationPlaylistInput.extend({
    tracks: z.array(StationPlaylistTrack),
});
export type StationPlaylistDetailInput = z.infer<typeof StationPlaylistDetailInput>;

/**
 * One record as a playlist file names it. By its words and its ISRC, never by an id of this station's:
 * ids are minted afresh by every library, so a file keyed by them would restore onto nothing
 * generated from [PlaylistFileTrack](../../../../data/contracts/playlists/station.playlists.types.ck#L57)
 */
export const PlaylistFileTrack = z.strictObject({
    title: z.string().min(1).max(400),
    artists: z.array(z.string().min(1).max(200)).describe('Ordered, primary artist first'),
    album: z.string().max(400).optional(),
    durationMs: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0)).optional(),
    isrc: z.string().max(100).optional(),
    origin: PlaylistFileOrigin.optional(),
});
export type PlaylistFileTrack = z.infer<typeof PlaylistFileTrack>;

/**
 * What an import WOULD do, written nowhere
 * generated from [PlaylistImportPlan](../../../../data/contracts/playlists/station.playlists.types.ck#L107)
 */
export const PlaylistImportPlan = z.strictObject({
    name: z.string().min(1).max(200),
    matched: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0)),
    toAdd: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0)),
    toLookUp: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0)),
    skipped: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe('Lines of the source that named no record the station could read'),
    entries: z.array(PlaylistImportEntry),
    notices: z.array(z.string().max(1000)).describe('Anything about the source as a whole an operator should know before importing it'),
});
export type PlaylistImportPlan = z.infer<typeof PlaylistImportPlan>;

/**
 * A playlist as a file: everything somebody would need to rebuild it on another station
 * generated from [PlaylistFile](../../../../data/contracts/playlists/station.playlists.types.ck#L67)
 */
export const PlaylistFile = z.strictObject({
    format: z.string().min(1).max(50).describe('What shape this is, so a file from a later build says so rather than being read wrongly'),
    takenAt: z.string().min(1).max(40).describe('When it was exported, ISO-8601'),
    station: z.string().max(100).optional().describe('The station it was taken from. Provenance only'),
    name: z.string().min(1).max(200),
    prompt: z.string().max(4000).optional(),
    tracks: z.array(PlaylistFileTrack),
});
export type PlaylistFile = z.infer<typeof PlaylistFile>;

/**
 * generated from [PlaylistImportResult](../../../../data/contracts/playlists/station.playlists.types.ck#L117)
 */
export const PlaylistImportResult = z.strictObject({
    plan: PlaylistImportPlan,
    playlist: StationPlaylist,
});
export type PlaylistImportResult = z.infer<typeof PlaylistImportResult>;

export const PlaylistImportResultInput = z.strictObject({
    plan: PlaylistImportPlan,
    playlist: StationPlaylistInput,
});
export type PlaylistImportResultInput = z.infer<typeof PlaylistImportResultInput>;

/**
 * Something to import a playlist from. Exactly one source
 * generated from [PlaylistImportInput](../../../../data/contracts/playlists/station.playlists.types.ck#L83)
 */
export const PlaylistImportInput = z.strictObject({
    file: PlaylistFile.optional().describe('A playlist exported from a deadair station'),
    text: z
        .string()
        .min(1)
        .max(4000000)
        .optional()
        .describe('A playlist another program wrote, as its text: an M3U, a CSV with a header row, or one `Artist - Title` per line'),
    format: z.enum(['m3u', 'csv', 'text']).optional().describe('Which of those `text` is. Absent works it out from the text'),
    fileName: z.string().max(400).optional().describe('The name of the file `text` came from, which names the playlist when the text does not'),
    url: z
        .string()
        .min(1)
        .max(2000)
        .optional()
        .describe("A link to a playlist at one of the station's music sources, as a browser or an app shows it"),
    providerPlaylist: PlaylistProviderRef.optional().describe('A playlist a music source lists here, by its plugin and its id'),
    name: z.string().min(1).max(200).optional().describe('What to call the new playlist. Absent keeps the name the source gives it'),
});
export type PlaylistImportInput = z.infer<typeof PlaylistImportInput>;
