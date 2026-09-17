import type { PluginHost } from '@deadair/plugin-sdk';
import { Innertube, Log } from 'youtubei.js';

import { createHostFetch } from './ytmusic.fetch.js';
import { isUnavailable } from './ytmusic.errors.js';
import { LIKED_PLAYLIST_ID } from './ytmusic.manifest.js';
import type { UpstreamItem } from './ytmusic.mapping.js';
import { pageOf, rowsOf, walk } from './ytmusic.paging.js';

/**
 * The InnerTube session and the four reads this plugin makes of it.
 *
 * Everything here goes out through `host.fetch` (see `createHostFetch`). Nothing in this file
 * catches its own errors into a value: the plugin above translates them, because only it knows
 * whether the call needed the credential, and that is the fact the translation turns on.
 */
export class YtMusicClient {
    private constructor(private readonly inner: Innertube) {}

    static async create(host: PluginHost, cookie: string): Promise<YtMusicClient> {
        // The library writes parser errors straight to the console. In-process that is the
        // station's own stdout rather than `host.logger`, so a plugin's upstream trouble would
        // surface as unattributed noise in the station log. Silenced here and reported through the
        // host instead.
        Log.setLevel();

        const inner = await Innertube.create({
            cookie,
            fetch: createHostFetch(host),
            // The player SCRIPT is the signature-deciphering path, which is only needed to turn a
            // format into a playable URL. This phase hands the station no audio, so fetching and
            // parsing it on every session would be work for nothing.
            retrieve_player: false,
        });

        return new YtMusicClient(inner);
    }

    /**
     * The account's own playlists.
     *
     * `getLibrary()` alone answers the library LANDING view, which is not the playlists. On a real
     * account it came back holding a podcast queue and nothing else. The Playlists view is behind
     * the chip, which is what `applyFilter` presses.
     */
    async libraryPlaylists(): Promise<UpstreamItem[]> {
        const library = await this.inner.music.getLibrary();
        const playlists = await library.applyFilter('Playlists');
        return rowsOf((playlists as { contents?: unknown[] })?.contents?.[0] ?? playlists);
    }

    /** A playlist's rows, all of them: paging is the caller's problem and it wants the whole thing once. */
    async playlistItems(playlistId: string): Promise<UpstreamItem[]> {
        const playlist = await this.inner.music.getPlaylist(playlistId);
        return await walk(pageOf(playlist));
    }

    /** The "Liked Music" list, which the library listing does not carry. */
    async likedPlaylist(): Promise<{ name?: string; items: UpstreamItem[] } | undefined> {
        try {
            const playlist = await this.inner.music.getPlaylist(LIKED_PLAYLIST_ID);
            const header = (playlist as { header?: { title?: { text?: string } } })?.header?.title?.text;
            return { name: header, items: rowsOf(playlist) };
        } catch {
            // An account with no liked music is not an error, and neither is a listing that has
            // moved. Either way there is simply no such playlist to offer.
            return undefined;
        }
    }

    /** Songs matching `query`, paging until `limit` of them are in hand. */
    async searchSongs(query: string, limit?: number): Promise<UpstreamItem[]> {
        const results = await this.inner.music.search(query, { type: 'song' });
        return await walk(pageOf(results), limit);
    }

    /** One record, or nothing when the upstream has no such video. */
    async track(trackId: string): Promise<UpstreamItem | undefined> {
        try {
            const info = await this.inner.music.getInfo(trackId);
            const basic = (info as { basic_info?: Record<string, unknown> })?.basic_info;
            if (!basic) return undefined;

            return {
                id: (basic.id as string | undefined) ?? trackId,
                title: basic.title as string | undefined,
                duration: { seconds: basic.duration as number | undefined },
                artists: basic.author ? [{ name: basic.author as string }] : [],
                thumbnails: basic.thumbnail as { url: string }[] | undefined,
            };
        } catch (error) {
            // "This video is unavailable" is the id being unknown, which the contract answers with
            // `undefined`. Anything else is a real failure and belongs to the caller.
            if (isUnavailable(error)) return undefined;
            throw error;
        }
    }
}
