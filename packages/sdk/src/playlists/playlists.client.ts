import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson } from '../sdk-options.js';
import type { CatalogPlaylistPage, CatalogPlaylistTracks } from './types/playlists.types.js';
import type {
    PlaylistFile,
    PlaylistImportInput,
    PlaylistImportPlan,
    PlaylistImportResult,
    StationPlaylist,
    StationPlaylistDetail,
    StationPlaylistList,
    StationPlaylistUpdate,
} from './types/station.playlists.types.js';
import {
    revivePlaylistImportResult,
    reviveStationPlaylist,
    reviveStationPlaylistDetail,
    reviveStationPlaylistList,
} from './types/station.playlists.types.js';

export class PlaylistsClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name List importable playlists
     * @description Fans out across every installed plugin that declares AND implements the `catalog` capability
     */
    async listImportablePlaylists(): Promise<CatalogPlaylistPage> {
        const result = await this.fetch(`/playlists`, { method: 'GET' });
        return await parseJson<CatalogPlaylistPage>(result);
    }

    /**
     * @name Get playlist tracks
     * @description One playlist's tracks from one plugin
     */
    async getPlaylistTracks(pluginId: string, playlistId: string): Promise<CatalogPlaylistTracks> {
        const result = await this.fetch(`/playlists/${encodeURIComponent(pluginId)}/${encodeURIComponent(playlistId)}/tracks`, { method: 'GET' });
        return await parseJson<CatalogPlaylistTracks>(result);
    }

    /**
     * @name Hide playlist
     * @description Hides one playlist from this station: the listing marks it hidden, the pickers stop offering it and the library sync stops reading it. Hiding one already hidden changes nothing
     */
    async hidePlaylist(pluginId: string, playlistId: string): Promise<void> {
        await this.fetch(`/playlists/${encodeURIComponent(pluginId)}/${encodeURIComponent(playlistId)}/hidden`, { method: 'PUT' });
    }

    /**
     * @name Show playlist
     * @description Shows a hidden playlist again. Showing one that is not hidden changes nothing
     */
    async showPlaylist(pluginId: string, playlistId: string): Promise<void> {
        await this.fetch(`/playlists/${encodeURIComponent(pluginId)}/${encodeURIComponent(playlistId)}/hidden`, { method: 'DELETE' });
    }

    /**
     * @name Refresh playlists
     * @description Reads every playlist on every music source again, in the background, rather than waiting for the next scheduled read. New records reach the library; records gone from every playlist are retired
     */
    async refreshPlaylists(): Promise<void> {
        await this.fetch(`/playlists/refresh`, { method: 'POST' });
    }

    /**
     * @name Refresh playlist
     * @description Reads one playlist again, in the background. New records reach the library; a record taken out of it stays until the next full read judges it
     */
    async refreshPlaylist(pluginId: string, playlistId: string): Promise<void> {
        await this.fetch(`/playlists/${encodeURIComponent(pluginId)}/${encodeURIComponent(playlistId)}/refresh`, { method: 'POST' });
    }

    /**
     * @name List station playlists
     * @description Every playlist the station owns, newest first
     */
    async listStationPlaylists(): Promise<StationPlaylistList> {
        const result = await this.fetch(`/station-playlists`, { method: 'GET' });
        return reviveStationPlaylistList(await parseJson<StationPlaylistList>(result));
    }

    /**
     * @name Get station playlist
     * @description One station playlist with its records in order, placeholders included
     */
    async getStationPlaylist(id: string): Promise<StationPlaylistDetail> {
        const result = await this.fetch(`/station-playlists/${encodeURIComponent(id)}`, { method: 'GET' });
        return reviveStationPlaylistDetail(await parseJson<StationPlaylistDetail>(result));
    }

    /**
     * @name Update station playlist
     * @description Renames a station playlist, or rewrites what it is for
     */
    async updateStationPlaylist(id: string, body: StationPlaylistUpdate): Promise<StationPlaylist> {
        const result = await this.fetch(`/station-playlists/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return reviveStationPlaylist(await parseJson<StationPlaylist>(result));
    }

    /**
     * @name Delete station playlist
     * @description Deletes a station playlist. The records it named stay in the library
     */
    async deleteStationPlaylist(id: string): Promise<void> {
        await this.fetch(`/station-playlists/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }

    /**
     * @name Fill station playlist
     * @description Looks up the records this playlist names and the library does not hold, in the background, and adds the ones a provider has. The activity feed says how it went
     */
    async fillStationPlaylist(id: string): Promise<void> {
        await this.fetch(`/station-playlists/${encodeURIComponent(id)}/fill`, { method: 'POST' });
    }

    /**
     * @name Export station playlist
     * @description One station playlist as a file another station can import
     */
    async exportStationPlaylist(id: string): Promise<{ data: PlaylistFile; headers: { contentDisposition?: string } }> {
        const result = await this.fetch(`/station-playlists/${encodeURIComponent(id)}/export`, { method: 'GET' });
        const data = await parseJson<PlaylistFile>(result);
        return { data, headers: { contentDisposition: result.headers.get('Content-Disposition') ?? undefined } };
    }

    /**
     * @name Preview playlist import
     * @description Reads a source and reports which of its records the library holds and which it would have to find. Writes nothing
     */
    async previewPlaylistImport(body: PlaylistImportInput): Promise<PlaylistImportPlan> {
        const result = await this.fetch(`/station-playlists/import/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<PlaylistImportPlan>(result);
    }

    /**
     * @name Import playlist
     * @description Makes a new station playlist from a source and answers with what it did
     */
    async importPlaylist(body: PlaylistImportInput): Promise<PlaylistImportResult> {
        const result = await this.fetch(`/station-playlists/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return revivePlaylistImportResult(await parseJson<PlaylistImportResult>(result));
    }
}
