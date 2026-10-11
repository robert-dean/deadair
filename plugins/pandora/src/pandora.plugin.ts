import {
    Plugin,
    PluginError,
    errorText,
    type GetPlaylistTracksOptions,
    type ListPlaylistsOptions,
    type MusicProviderPluginInstance,
    type PluginConnectionResult,
    type PluginHost,
    type ProviderPlaylist,
    type ProviderTrack,
    type SearchTracksOptions,
} from '@deadair/plugin-sdk';

import { annotationsOf, mapPlaylist, mapTrack, mapTracks, pandoraPlaylistIdFromUrl, type PandoraAnnotation, type PandoraAnnotations } from './pandora.mapping.js';
import { ANNOTATE_BATCH, PLAYLIST_PAGE_SIZE, SEARCH_PAGE_SIZE, configSchema } from './pandora.manifest.js';
import { PandoraSession } from './pandora.session.js';

export { pandoraManifest } from './pandora.manifest.js';

/** What `v3/sod/search` answers: ids in rank order, and what each one is. */
interface SearchReply {
    results?: unknown[];
    annotations?: PandoraAnnotations;
}

/** What `v6/collections/getSortedPlaylists` answers: the account's playlists, a page at a time. */
interface PlaylistsReply {
    items?: Array<{ pandoraId?: string; name?: string }>;
    annotations?: PandoraAnnotations;
    totalCount?: number;
}

/** What `v7/playlists/getTracks` answers: one page of a playlist's entries. */
interface PlaylistTracksReply {
    tracks?: Array<{ pandoraId?: string }>;
    totalTracks?: number;
    annotations?: PandoraAnnotations;
}

/** `limit` read the SDK's way: a total, with nothing set meaning one page. */
const totalOf = (limit: number | undefined, page: number): number => (limit !== undefined && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : page);
const offsetOf = (offset: number | undefined): number => (offset !== undefined && Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0);

/**
 * Pandora as a deadair `music-provider`.
 *
 * Unofficial from top to bottom: Pandora publishes no API. It signs in the way Pandora's own Android
 * app does and then talks to the web app's API, which is what pianobar, pydora and pandora-tui have
 * done for years. It works only from the US, and Pandora can change any of it without notice.
 *
 * The catalog half needs nothing but an account: search, a record's details (ISRC included, which is
 * what lets the station match a Pandora record to a copy it already has), and the account's
 * playlists. Playing a CHOSEN record, which is the only kind of playing a station does, needs
 * Pandora Premium.
 */
export class PandoraPlugin extends Plugin implements MusicProviderPluginInstance {
    private session?: PandoraSession;

    protected async onLoad(): Promise<void> {
        const config = configSchema.parse(await this.host.config.get());
        const password = await this.host.secrets.get('password');
        if (!password) throw new PluginError('Pandora password is not configured').withCode('config');

        this.session = new PandoraSession(config.email, password);
        this.register(() => this.session?.reset());
    }

    /**
     * Signs in, which proves the email, the password and that the station reaches Pandora from the US
     * all at once, and says whether the account can play chosen records.
     *
     * A refusal is reported rather than thrown: this is the button next to the form.
     */
    async testConnection(): Promise<PluginConnectionResult> {
        const host = this.host;
        try {
            const premium = await this.require().isSubscriber(host);
            return premium
                ? { ok: true, message: 'Signed in to Pandora Premium.' }
                : { ok: true, message: 'Signed in. This account is not Pandora Premium, so the station can search Pandora but not play from it.' };
        } catch (error) {
            return { ok: false, message: errorText(error) };
        }
    }

    // --- catalog -------------------------------------------------------------

    /**
     * Pandora's search matches text and offers no period filter, so a narrowed search is one this
     * provider has nothing to offer for, and it answers with nothing (the SDK's rule).
     *
     * Search answers with every kind of object at once, so it is asked for tracks only, paged up to
     * the caller's total.
     */
    async searchTracks(query: string, options?: SearchTracksOptions): Promise<ProviderTrack[]> {
        if (options?.yearFrom !== undefined || options?.yearTo !== undefined) return [];
        const host = this.host;
        const session = this.require();

        const total = totalOf(options?.limit, SEARCH_PAGE_SIZE);
        let start = offsetOf(options?.offset);
        const found: ProviderTrack[] = [];
        // Pandora can answer a later page with records an earlier one already held. So the answer is
        // de-duplicated, and a page that adds nothing new ends the walk rather than repeating it.
        const seen = new Set<string>();
        while (found.length < total) {
            const count = Math.min(SEARCH_PAGE_SIZE, total - found.length);
            const reply = await session.web<SearchReply>(host, 'v3/sod/search', {
                query,
                types: ['TR'],
                listener: null,
                start,
                count,
                annotate: true,
                searchTime: 0,
                annotationRecipe: 'CLASS_OF_2019',
            });
            const ids = (reply.results ?? []).filter((id): id is string => typeof id === 'string');
            const fresh = ids.filter(id => !seen.has(id));
            fresh.forEach(id => seen.add(id));
            found.push(...mapTracks(fresh, reply.annotations ?? {}));
            if (ids.length < count || fresh.length === 0) break;
            start += ids.length;
        }
        return found.slice(0, total);
    }

    async getTrack(trackId: string): Promise<ProviderTrack | undefined> {
        if (!trackId.startsWith('TR:')) return undefined;
        const host = this.host;
        const annotations = await this.annotate(host, [trackId]);
        return mapTrack(trackId, annotations);
    }

    /**
     * The account's own playlists, newest edit first. Every one Pandora lists is reported, since the
     * host reads a short page as the end of the list.
     */
    async listPlaylists(options?: ListPlaylistsOptions): Promise<ProviderPlaylist[]> {
        const host = this.host;
        const session = this.require();

        const total = totalOf(options?.limit, PLAYLIST_PAGE_SIZE);
        let offset = offsetOf(options?.offset);
        const playlists: ProviderPlaylist[] = [];
        while (playlists.length < total) {
            const limit = Math.min(PLAYLIST_PAGE_SIZE, total - playlists.length);
            const reply = await session.web<PlaylistsReply>(host, 'v6/collections/getSortedPlaylists', {
                request: { sortOrder: 'MOST_RECENT_MODIFIED', offset, limit, annotationLimit: limit },
            });
            const items = reply.items ?? [];
            for (const item of items) {
                if (!item.pandoraId?.startsWith('PL:')) continue;
                playlists.push(mapPlaylist(item.pandoraId, reply.annotations?.[item.pandoraId], item.name));
            }
            offset += items.length;
            if (items.length < limit || (reply.totalCount !== undefined && offset >= reply.totalCount)) break;
        }
        return playlists;
    }

    /**
     * One page of a playlist's records. Pandora answers with ids; their details are asked for
     * alongside, so an entry it cannot describe is left out rather than reported half-known.
     */
    async getPlaylistTracks(playlistId: string, options?: GetPlaylistTracksOptions): Promise<ProviderTrack[]> {
        const host = this.host;
        const session = this.require();

        const total = totalOf(options?.limit, PLAYLIST_PAGE_SIZE);
        let offset = offsetOf(options?.offset);
        const tracks: ProviderTrack[] = [];
        while (tracks.length < total) {
            const limit = Math.min(PLAYLIST_PAGE_SIZE, total - tracks.length);
            const reply = await session.web<PlaylistTracksReply>(host, 'v7/playlists/getTracks', { request: { pandoraId: playlistId, offset, limit } });
            const ids = (reply.tracks ?? []).map(entry => entry.pandoraId).filter((id): id is string => id?.startsWith('TR:') === true);
            const annotations = { ...(reply.annotations ?? {}), ...(await this.annotate(host, ids.filter(id => reply.annotations?.[id] === undefined))) };
            tracks.push(...mapTracks(ids, annotations));

            const seen = reply.tracks?.length ?? 0;
            offset += seen;
            if (seen < limit || (reply.totalTracks !== undefined && offset >= reply.totalTracks)) break;
        }
        return tracks;
    }

    playlistIdFromUrl(url: string): string | undefined {
        return pandoraPlaylistIdFromUrl(url);
    }

    // --- helpers -------------------------------------------------------------

    /** Details for `ids`, in batches Pandora will take. */
    protected async annotate(host: PluginHost, ids: readonly string[]): Promise<PandoraAnnotations> {
        const annotations: Record<string, PandoraAnnotation | undefined> = {};
        for (let at = 0; at < ids.length; at += ANNOTATE_BATCH) {
            const reply = await this.require().web<unknown>(host, 'v4/catalog/annotateObjects', { pandoraIds: ids.slice(at, at + ANNOTATE_BATCH) });
            Object.assign(annotations, annotationsOf(reply));
        }
        return annotations;
    }

    protected require(): PandoraSession {
        if (this.session === undefined) throw new PluginError('Pandora is not initialized').withCode('unavailable');
        return this.session;
    }
}
