import {
    Plugin,
    PluginError,
    errorText,
    type GetPlaylistTracksOptions,
    type ListPlaylistsOptions,
    type MusicProviderPluginInstance,
    type PluginConnectionResult,
    type ProviderPlaylist,
    type ProviderTrack,
    type SearchTracksOptions,
} from '@deadair/plugin-sdk';

import { YtMusicClient } from './ytmusic.client.js';
import { toPluginError } from './ytmusic.errors.js';
import { LIKED_PLAYLIST_ID, LIKED_PLAYLIST_NAME, PLAYLIST_MEMO_TTL_MS } from './ytmusic.manifest.js';
import { mapPlaylists, mapTracks } from './ytmusic.mapping.js';
import type { UpstreamItem } from './ytmusic.mapping.js';

interface MemoEntry {
    items: UpstreamItem[];
    at: number;
}

/**
 * YouTube Music as a deadair `music-provider`, catalog half only.
 *
 * It searches and it lists playlists; it hands the station no audio and says so in its manifest by
 * declaring `catalog` and not `stream`. That is a supported state rather than a half-finished one:
 * `asStreamPlugin` answers `undefined` for a plugin that never declared it, the running order skips
 * the item and holds nothing against the plugin. The reason it stops here is that a YouTube media
 * URL is bound to the client identity that minted it and needs matching `User-Agent`, `Origin` and
 * `Referer` headers, which is precisely what `resolveStreamUrl` promises a URL will not need, since
 * the player fetches it with no headers from us. Serving one needs a header-fixing range
 * proxy beside the station. See discussion #49.
 *
 * The credential is a cookie the operator pastes, not OAuth, and not by preference: Google withdrew
 * OAuth for this service in late 2024 and there is nothing else on offer. It follows that there is
 * no refresh, so the cookie dies on the account's own schedule and this plugin's main job around it
 * is to say so out loud. See `probe`.
 */
export class YtMusicPlugin extends Plugin implements MusicProviderPluginInstance {
    private client?: YtMusicClient;

    /**
     * One playlist's rows, kept briefly.
     *
     * The host reads a playlist an OFFSET at a time and YouTube pages by continuation token, so
     * serving an arbitrary offset means walking from the start of the playlist. Without this, a sync
     * over one playlist is quadratic in its length: the same hundred rows re-fetched for every page
     * after them. In memory rather than in `host.storage` because it is a cache and not a fact, and
     * a plugin that needs no storage permission should not ask for one.
     */
    private readonly memo = new Map<string, MemoEntry>();

    protected async onLoad(): Promise<void> {
        const host = this.host;

        const cookie = (await host.secrets.get('cookie'))?.trim();
        if (!cookie) throw new PluginError('YouTube Music needs the cookie from a signed-in browser session').withCode('config');

        const client = await YtMusicClient.create(host, cookie);

        // The credential is checked by USING it, before the plugin is declared ready. See `probe`.
        const failure = await this.probe(client);
        if (failure) throw new PluginError(`YouTube Music did not accept the cookie: ${failure}`).withCode('config');

        this.client = client;
        this.register(() => {
            // The client goes with the memo. It closes over the host, which `dispose()` releases,
            // so an instance left holding one answers calls with a session whose egress is gone --
            // and a method that never touches `this.host` directly would never hit the base class's
            // guard to find out. Measured by the test below: without this, a disposed plugin
            // answered a search with an empty list instead of refusing.
            this.client = undefined;
            this.memo.clear();
        });
        host.logger.info('youtube music ready');
    }

    /**
     * Is the cookie actually working? Answered by making the one call that cannot work without it.
     *
     * **Every cheaper check is wrong, and each was measured rather than reasoned about.** The
     * design note for this plugin proposed looking for `__Secure-3PAPISID` in the cookie, on the
     * grounds that an anonymous capture lacks it; removing that cookie entirely left an
     * authenticated library read working, so the check would reject cookies that work and accept
     * cookies that do not. `session.logged_in` is no better: it stays `true` with every session
     * cookie corrupted, because it means "a cookie string was supplied" and nothing more. And a
     * check that goes through SEARCH cannot fail at all, because search is served to signed-out
     * callers: every broken cookie still returned a full page of results.
     *
     * That last one is also why this matters more than it looks. A dead cookie does not make the
     * station obviously broken: searches keep working while the library goes dark, so the rotation
     * thins quietly and the plugin's card says nothing is wrong. The whole point of probing is to
     * turn that into a sentence somebody can act on.
     *
     * Resolves to the reason it failed, or `undefined` when the credential is good.
     */
    private async probe(client: YtMusicClient): Promise<string | undefined> {
        try {
            await client.libraryPlaylists();
            return undefined;
        } catch (error) {
            return errorText(toPluginError(error, 'authenticated'));
        }
    }

    /**
     * The settings card's button, and the way back on air for a quarantined plugin.
     *
     * Reports rather than throws: the operator is mid-paste and the message is theirs to act on.
     */
    async testConnection(): Promise<PluginConnectionResult> {
        const client = this.require();
        const failure = await this.probe(client);
        if (failure) return { ok: false, message: failure };
        return { ok: true, message: 'Connected to YouTube Music.' };
    }

    // --- catalog -------------------------------------------------------------

    /**
     * YouTube Music's search takes no period, so a search narrowed by one is a search this provider
     * has nothing to offer for, and it answers with nothing.
     *
     * That is the SDK's rule rather than a shortcut, and the alternative is worse than it looks: the
     * caller merges every provider's rows into one list with nothing marking which of them honoured
     * the filter, so ignoring a period does not degrade the answer, it poisons it: the station asks for
     * records from 1955 and is handed something else with nothing saying so.
     */
    async searchTracks(query: string, options?: SearchTracksOptions): Promise<ProviderTrack[]> {
        if (options?.yearFrom !== undefined || options?.yearTo !== undefined) return [];

        const client = this.require();
        const offset = options?.offset ?? 0;
        const limit = options?.limit;

        try {
            // The upstream has no offset of its own, so a page past the first is taken off the front
            // of a longer walk.
            const rows = await client.searchSongs(query, limit === undefined ? undefined : offset + limit);
            return mapTracks(rows.slice(offset));
        } catch (error) {
            throw toPluginError(error, 'public');
        }
    }

    /** `undefined` when the id is unknown, which is what the upstream's "video unavailable" means. */
    async getTrack(trackId: string): Promise<ProviderTrack | undefined> {
        const client = this.require();
        try {
            const item = await client.track(trackId);
            return item ? mapTracks([item])[0] : undefined;
        } catch (error) {
            throw toPluginError(error, 'public');
        }
    }

    /**
     * The account's playlists, with "Liked Music" in front.
     *
     * Liked Music is addressed directly because the library listing does not carry it, and it is
     * worth the extra request: on most accounts it is the closest thing to the operator's own
     * rotation pool. `plugins/navidrome` synthesises an everything-playlist for the same reason.
     *
     * Rows that are not playlists are dropped in `mapPlaylist`, because the Playlists view also
     * carries a "New playlist" button. Dropping a real playlist would be a different matter entirely, since
     * the host reads a short page as the end of the list.
     */
    async listPlaylists(options?: ListPlaylistsOptions): Promise<ProviderPlaylist[]> {
        const client = this.require();

        let playlists: ProviderPlaylist[];
        try {
            playlists = mapPlaylists(await client.libraryPlaylists());
        } catch (error) {
            throw toPluginError(error, 'authenticated');
        }

        const liked = await client.likedPlaylist();
        if (liked) {
            playlists = [
                { id: LIKED_PLAYLIST_ID, name: liked.name ?? LIKED_PLAYLIST_NAME, trackCount: liked.items.length, madeByProvider: true },
                ...playlists.filter(playlist => playlist.id !== LIKED_PLAYLIST_ID),
            ];
        }

        const offset = options?.offset ?? 0;
        const limit = options?.limit;
        return limit === undefined ? playlists.slice(offset) : playlists.slice(offset, offset + limit);
    }

    /**
     * One page of a playlist, served off the memo so a sync's sequential offsets cost one walk.
     *
     * A playlist id the upstream does not know does not raise: it answers an empty playlist, so `[]`
     * is the honest answer here rather than an error invented to fill the silence.
     */
    async getPlaylistTracks(playlistId: string, options?: GetPlaylistTracksOptions): Promise<ProviderTrack[]> {
        const client = this.require();
        const offset = options?.offset ?? 0;
        const limit = options?.limit;

        let items: UpstreamItem[];
        try {
            items = await this.itemsFor(client, playlistId);
        } catch (error) {
            throw toPluginError(error, 'authenticated');
        }

        const page = limit === undefined ? items.slice(offset) : items.slice(offset, offset + limit);
        return mapTracks(page);
    }

    private async itemsFor(client: YtMusicClient, playlistId: string): Promise<UpstreamItem[]> {
        const cached = this.memo.get(playlistId);
        if (cached && Date.now() - cached.at < PLAYLIST_MEMO_TTL_MS) return cached.items;

        const items = await client.playlistItems(playlistId);
        this.memo.set(playlistId, { items, at: Date.now() });
        return items;
    }

    /**
     * The client, or the SDK's own sentence about being used outside its life.
     *
     * There is no third state to confuse this with: `onLoad` throws rather than returning without a
     * client, so an instance the host considers active always has one, and an absent client means
     * this instance is either not yet initialised or already disposed.
     */
    private require(): YtMusicClient {
        if (!this.client) throw new PluginError('YouTube Music was used before init() or after dispose()').withCode('internal');
        return this.client;
    }
}
