import { PluginError } from '@deadair/plugin-sdk';
import type { PluginHost } from '@deadair/plugin-sdk';
import { Innertube, Log, Utils } from 'youtubei.js';

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

    static async create(host: PluginHost, cookie: string, accountIndex = 0): Promise<YtMusicClient> {
        // The library writes parser errors straight to the console. In-process that is the
        // station's own stdout rather than `host.logger`, so a plugin's upstream trouble would
        // surface as unattributed noise in the station log. Silenced here and reported through the
        // host instead.
        Log.setLevel();

        const inner = await Innertube.create({
            cookie,
            // Which of the cookie's signed-in accounts to speak for. See `DEFAULT_ACCOUNT_INDEX`.
            account_index: accountIndex,
            fetch: createHostFetch(host),
            // The player SCRIPT is the signature-deciphering path, which is only needed to turn a
            // format into a playable URL. This phase hands the station no audio, so fetching and
            // parsing it on every session would be work for nothing.
            retrieve_player: false,
        });

        return new YtMusicClient(inner);
    }

    /**
     * Whether the cookie is actually working, asked of the account rather than of the library.
     *
     * This is the plugin's credential check, and it reads the ACCOUNT on purpose. The obvious probe
     * is a library read, since that is the thing that needs authorising, and it is wrong for a
     * reason only a live account showed: an EMPTY library section answers the very same
     * `ParsingError` as a signed-out page (`Expected node of any type Grid, MusicShelf, got
     * ItemSection`), because the upstream renders both as a message rather than a grid. Measured
     * with a good cookie: the Songs and Albums sections of an account with none of either threw
     * exactly what a dead credential throws. So an operator who simply has no playlists yet would
     * have been told their cookie was invalid, and the plugin would have refused to start on a
     * perfectly good one.
     *
     * The account endpoint depends on the credential and on nothing else, which is the property the
     * check needs: with a good cookie it answers a name, and with a corrupted one it throws.
     */
    async assertSignedIn(): Promise<string | undefined> {
        try {
            const info = await this.inner.account.getInfo();
            const accounts = (info as { contents?: { contents?: { account_name?: { text?: string } }[] } })?.contents?.contents ?? [];
            return accounts[0]?.account_name?.text;
        } catch (error) {
            throw new PluginError(`YouTube Music did not accept the cookie: ${error instanceof Error ? error.message : String(error)}`).withCode(
                'auth',
            );
        }
    }

    /**
     * The account's own playlists.
     *
     * `getLibrary()` alone answers the library LANDING view, which is not the playlists. On a real
     * account it came back holding a podcast queue and nothing else. The Playlists view is behind
     * the chip, which is what `applyFilter` presses.
     *
     * A `ParsingError` here is genuinely ambiguous, for the reason {@link assertSignedIn} sets out:
     * it is either an empty section or a dead cookie. Rather than guess, ask the account. An empty
     * library is `[]`, which is the truth about a station with no playlists; a dead cookie keeps
     * its `auth` code, so the one case this plugin exists to report out loud still gets reported
     * out loud rather than being flattened into an empty catalog.
     */
    async libraryPlaylists(): Promise<UpstreamItem[]> {
        try {
            const library = await this.inner.music.getLibrary();
            const playlists = await library.applyFilter('Playlists');
            return rowsOf((playlists as { contents?: unknown[] })?.contents?.[0] ?? playlists);
        } catch (error) {
            if (!(error instanceof Utils.ParsingError)) throw error;
            await this.assertSignedIn();
            return [];
        }
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
