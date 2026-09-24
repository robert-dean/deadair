import {
    Plugin,
    PluginError,
    errorText,
    type GetPlaylistTracksOptions,
    type ListPlaylistsOptions,
    type MusicProviderPluginInstance,
    type PluginConnectionResult,
    type ProviderPlaylist,
    type ProviderStream,
    type ProviderTrack,
    type SearchTracksOptions,
} from '@deadair/plugin-sdk';

import { YtMusicClient } from './ytmusic.client.js';
import { toPluginError } from './ytmusic.errors.js';
import {
    accountIndexOf,
    DEFAULT_ACCOUNT_INDEX,
    LIKED_PLAYLIST_ID,
    LIKED_PLAYLIST_NAME,
    PLAYLIST_MEMO_TTL_MS,
    sameList,
    type YtMusicConfig,
} from './ytmusic.manifest.js';
import { resolverFor, type ResolverClient } from './ytmusic.resolver.js';
import { mapPlaylists, mapTracks, ytmusicPlaylistIdFromUrl } from './ytmusic.mapping.js';
import type { UpstreamItem } from './ytmusic.mapping.js';

interface MemoEntry {
    items: UpstreamItem[];
    at: number;
}

/**
 * YouTube Music as a deadair `music-provider`: search, the library and playlists in-process, and the
 * audio through `ytaudio/`, a yt-dlp sidecar that answers a plain URL the station fetches itself.
 *
 * The two halves authenticate differently, on purpose. The catalog half is signed in with the
 * operator's cookie, because a library is an account's. The audio half is signed OUT, and the
 * cookie never reaches the resolver: signed in, YouTube serves it nothing it can fetch. See
 * `ResolverClient.resolve` and discussion #49.
 *
 * The credential is a cookie the operator pastes, not OAuth, and not by preference: Google withdrew
 * OAuth for this service in late 2024 and there is nothing else on offer. It follows that there is
 * no refresh, so the cookie dies on the account's own schedule and this plugin's main job around it
 * is to say so out loud. See `probe`.
 */
export class YtMusicPlugin extends Plugin implements MusicProviderPluginInstance {
    private client?: YtMusicClient;
    private resolver?: ResolverClient;
    /** Kept from `onLoad` so `testConnection` never reads `this.host` after an `await` to find it. */
    private accountIndex = DEFAULT_ACCOUNT_INDEX;

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

        // Read leniently, NOT through `configSchema.parse`, which is the analyzer's rule and for the
        // same reason. The schema is what a SAVE is validated against; what is already stored may
        // predate a field. A config saved before `resolverBaseUrl` existed has none, and parsing it
        // strictly threw a raw ZodError out of here -- taking the catalog half down over a missing
        // audio setting, with a message about a schema rather than about what to do.
        const config = (await host.config.get()) as Partial<YtMusicConfig>;
        const cookie = (await host.secrets.get('cookie'))?.trim();
        if (!cookie) throw new PluginError('YouTube Music needs the cookie from a signed-in browser session').withCode('config');

        const accountIndex = accountIndexOf(config.accountIndex);
        this.accountIndex = accountIndex;
        const client = await YtMusicClient.create(host, cookie, accountIndex);

        // The credential is checked by USING it, before the plugin is declared ready. See `probe`.
        // `probe` already phrases the failure for whoever reads the settings card; wrapping it again
        // here only doubles the sentence.
        const failure = await this.probe(client);
        if (failure) throw new PluginError(failure).withCode('config');

        this.client = client;

        // The audio half is optional at load. A station that has not set the
        // resolver up still has a working catalog, and `resolveStreamUrl` simply
        // answers nothing -- which the host reads as "not available" and skips.
        // Refusing to start over it would take the search away too. Nothing is
        // handed to it: audio resolves signed out, so the cookie stays here. See
        // `ResolverClient.resolve` for why.
        this.resolver = resolverFor(host, config.resolverBaseUrl);
        if (this.resolver) {
            host.logger.info('youtube music: audio resolves signed out through the configured resolver');
        } else {
            // Not configured, or saved before the field existed. Saving the plugin's settings once
            // fills it with the default, which is also what puts its address on the allowlist.
            host.logger.info('youtube music: no audio resolver configured, so nothing will play; save the plugin settings to set one');
        }

        this.register(() => {
            // The client goes with the memo. It closes over the host, which `dispose()` releases,
            // so an instance left holding one answers calls with a session whose egress is gone --
            // and a method that never touches `this.host` directly would never hit the base class's
            // guard to find out. Measured by the test below: without this, a disposed plugin
            // answered a search with an empty list instead of refusing.
            this.client = undefined;
            this.resolver = undefined;
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
     * And it asks the ACCOUNT rather than reading the library, which is the correction a live
     * account forced: an empty library section throws the same `ParsingError` as a signed-out page,
     * so a library-based probe refuses a perfectly good cookie belonging to an operator who simply
     * has no playlists yet. See `YtMusicClient.assertSignedIn`.
     *
     * Resolves to the reason it failed, or `undefined` when the credential is good.
     */
    private async probe(client: YtMusicClient): Promise<string | undefined> {
        try {
            await client.assertSignedIn();
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
        const name = await client.assertSignedIn().catch(() => undefined);
        // The account index beside the name, because a name alone did not tell an operator which of
        // their accounts this was: a work account and a personal one can carry the same name.
        const index = this.accountIndex;
        const who = name ? `Connected to YouTube Music as ${name} (account ${index}).` : `Connected to YouTube Music (account ${index}).`;

        // The catalog half and the audio half fail independently, and an operator
        // needs to know which one is down: a green card over a station that can
        // search and cannot play is the report this whole plugin is trying not to
        // give.
        //
        // An unreachable resolver answers `ok: false`, which is the rule the
        // analyzer and both speech plugins were changed to follow in #180 and is
        // right for the same reason. It is a server the OPERATOR runs, so it is
        // off sometimes, and the thing they have to fix is an address. `ok: false`
        // is safe to say: a FAILED test is a report, and only a test that THROWS
        // can count against the plugin and quarantine it. Nothing here throws.
        //
        // The message keeps saying the catalog works, because `ok: false` on its
        // own would read as a plugin that does nothing when search is fine.
        if (!this.resolver) return { ok: false, message: `${who} No audio resolver is configured, so search works and nothing will play.` };

        const audio = await this.resolver.reachable();
        if (!audio.ok) return { ok: false, message: `${who} ${audio.message}, so search works and nothing will play.` };
        return { ok: true, message: `${who} ${audio.message}.` };
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

    // --- stream ---------------------------------------------------------------

    /**
     * Where this record's audio is, or nothing.
     *
     * The URL is not this plugin's to mint. `ytaudio/` resolves it with yt-dlp,
     * because the library that knows how is Python and this is Node inside the
     * host's own process, and what comes back is an ordinary HTTPS URL carrying
     * its own authentication in its query string. The station fetches and caches
     * it exactly as it does a Navidrome URL: nothing proxies bytes.
     *
     * Resolved SIGNED OUT. The cookie never leaves this plugin: signed in, YouTube serves the
     * resolver nothing it can fetch, and signed out it does. See `ResolverClient.resolve`.
     *
     * `undefined` at every "not yet" and every "not this record": no resolver
     * configured, resolver not answering, record the upstream will not serve. The host reads all of them as unavailable, skips
     * the item and holds nothing against the plugin, which is right -- none of
     * them is the plugin misbehaving, and a catalog that works must not be
     * quarantined by an audio path that does not.
     */
    async resolveStreamUrl(trackId: string): Promise<ProviderStream | undefined> {
        const resolver = this.resolver;
        if (!resolver) return undefined;
        return await resolver.resolve(trackId);
    }

    // --- catalog, continued -----------------------------------------------------

    /** A pasted YouTube Music or YouTube playlist link, as the playlist id it names. */
    playlistIdFromUrl(url: string): string | undefined {
        return ytmusicPlaylistIdFromUrl(url);
    }

    /**
     * The account's playlists, with "Liked Music" in front when it has anything in it.
     *
     * The library lists Liked Music itself once the account has liked something, and then this adds
     * nothing: adding a second copy is the duplicate this used to show. When the library leaves it out
     * it is fetched directly and put in front, because on most accounts it is the closest thing to the
     * operator's own rotation pool. `plugins/navidrome` synthesises an everything-playlist for the same
     * reason. An empty one is not added, since a list with nothing to air is only noise in a picker.
     *
     * Never `madeByProvider`. That marks what the SERVICE pushes at an account, editorial lists and
     * generated mixes, so the console can fold them out of the way, and Spotify sets it on exactly
     * those. Liked Music is the operator's own choices. It was marked, which folded one copy away and
     * left the library's copy showing, and that is how the duplicate looked like two different lists.
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

        if (!playlists.some(playlist => sameList(playlist.id, LIKED_PLAYLIST_ID))) {
            const liked = await client.likedPlaylist();
            if (liked && liked.items.length > 0) {
                playlists = [{ id: LIKED_PLAYLIST_ID, name: liked.name ?? LIKED_PLAYLIST_NAME, trackCount: liked.items.length }, ...playlists];
            }
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
