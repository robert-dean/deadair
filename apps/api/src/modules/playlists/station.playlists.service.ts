import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { JobBroker } from '@maroonedsoftware/jobbroker';
import { DateTime } from 'luxon';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { fileTrackOf, PLAYLIST_FILE_FORMAT } from './playlist.file.js';
import { StationPlaylistsRepository, type StationPlaylistRow, type StationPlaylistRowTrack } from './station.playlists.repository.js';
import type {
    PlaylistFile,
    StationPlaylist,
    StationPlaylistDetail,
    StationPlaylistList,
    StationPlaylistTrack,
    StationPlaylistUpdate,
} from './types/station.playlists.types.js';

/**
 * The playlists the station owns: reading them, renaming them, deleting them and writing them out as
 * a file. Taking one IN is `PlaylistImportService`.
 */
@Injectable()
export class StationPlaylistsService {
    constructor(
        private readonly playlists: StationPlaylistsRepository,
        private readonly station: StationIdentity,
        // Scoped, so a fill is enqueued in the request's transaction.
        private readonly jobs: JobBroker,
    ) {}

    async list(): Promise<StationPlaylistList> {
        return { playlists: (await this.playlists.list()).map(toStationPlaylist) };
    }

    /** @throws 404 for an id this station does not hold. */
    async get(id: string): Promise<StationPlaylistDetail> {
        const playlist = await this.require(id);
        const tracks = await this.playlists.tracks(id);
        return { ...toStationPlaylist(playlist), tracks: tracks.map(toStationPlaylistTrack) };
    }

    /** @throws 404 for an id this station does not hold. */
    async update(id: string, changes: StationPlaylistUpdate): Promise<StationPlaylist> {
        if (!(await this.playlists.update(id, changes))) throw notFound(id);
        return toStationPlaylist(await this.require(id));
    }

    /** @throws 404 for an id this station does not hold, so a second delete is not reported as a first. */
    async delete(id: string): Promise<void> {
        if (!(await this.playlists.delete(id))) throw notFound(id);
    }

    /**
     * Look up the records this playlist names and the library does not hold, in the background. It
     * answers when the request is taken rather than when the look-up is done, and the finished run
     * is announced on the activity feed.
     *
     * @throws 404 for an id this station does not hold.
     */
    async requestFill(id: string): Promise<void> {
        await this.require(id);
        await this.jobs.send('playlists.fill', { playlistId: id });
    }

    /**
     * One playlist as a file another station can import.
     *
     * `origin_plugin_id` on the playlist does not travel: it is a badge naming where THIS station
     * cloned it from, and the receiving station did not. A placeholder's origin does, because it is
     * how that row can still be matched on the far side.
     *
     * @throws 404 for an id this station does not hold, rather than an empty file that would look like
     *   an export that worked.
     */
    async export(id: string): Promise<{ body: PlaylistFile; headers: { contentDisposition: string } }> {
        const playlist = await this.require(id);
        const tracks = await this.playlists.tracks(id);
        const takenAt = DateTime.utc();

        return {
            body: {
                format: PLAYLIST_FILE_FORMAT,
                takenAt: takenAt.toISO(),
                station: this.station.stationKey,
                name: playlist.name,
                ...(playlist.prompt.length === 0 ? {} : { prompt: playlist.prompt }),
                tracks: tracks.map(fileTrackOf),
            },
            headers: { contentDisposition: `attachment; filename="${safeFileName(playlist.name)}-${takenAt.toFormat('yyyy-LL-dd')}.json"` },
        };
    }

    private async require(id: string): Promise<StationPlaylistRow> {
        const playlist = await this.playlists.find(id);
        if (playlist === undefined) throw notFound(id);
        return playlist;
    }
}

const notFound = (id: string) => httpError(404).withDetails({ message: `station playlist "${id}" does not exist` });

export function toStationPlaylist(row: StationPlaylistRow): StationPlaylist {
    return {
        id: row.id,
        name: row.name,
        prompt: row.prompt,
        ...(row.originPluginId === undefined ? {} : { originPluginId: row.originPluginId }),
        trackCount: row.trackCount,
        resolvedCount: row.resolvedCount,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

function toStationPlaylistTrack(row: StationPlaylistRowTrack): StationPlaylistTrack {
    return {
        id: row.id,
        position: row.position,
        title: row.title,
        // The contract refuses an empty name, and a credit read from a snapshot or a catalog row can
        // be one. Dropped rather than failing the whole listing over one blank credit.
        artists: row.artists.filter(artist => artist.length > 0),
        ...(row.album === undefined ? {} : { album: row.album }),
        ...(row.durationMs === undefined ? {} : { durationMs: row.durationMs }),
        ...(row.trackId === undefined ? {} : { trackId: row.trackId }),
        ...(row.artistId === undefined ? {} : { artistId: row.artistId }),
        ...(row.albumId === undefined ? {} : { albumId: row.albumId }),
        ...(row.trackId === undefined && row.originPluginId !== undefined ? { originPluginId: row.originPluginId } : {}),
    };
}

/**
 * A playlist's name as a filename. A name is free text, and a `"` or a `/` in a
 * `Content-Disposition` filename is a header somebody else's browser gets to interpret.
 */
function safeFileName(name: string): string {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return slug.length === 0 ? 'playlist' : slug;
}
