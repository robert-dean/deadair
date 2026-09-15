import type { SdkFetch } from '../sdk-options.js';
import { parseJson } from '../sdk-options.js';
import type { CatalogPlaylistPage, CatalogPlaylistTracks } from './types/playlists.types.js';

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
}
