import {
    Plugin,
    PluginError,
    errorText,
    type GetPlaylistTracksOptions,
    type ListPlaylistsOptions,
    type PlaybackReport,
    type MusicProviderPluginInstance,
    type PluginConnectionResult,
    type PluginHost,
    type ProviderPlaylist,
    type ProviderStream,
    type ProviderTrack,
    type SearchTracksOptions,
} from '@deadair/plugin-sdk';

import { annotationsOf, mapPlaylist, mapTrack, mapTracks, pandoraPlaylistIdFromUrl, type PandoraAnnotation, type PandoraAnnotations } from './pandora.mapping.js';
import { ANNOTATE_BATCH, BUSY_RETRY_MS, PLAYLIST_PAGE_SIZE, SEARCH_PAGE_SIZE, SERVED_MEMORY, configSchema } from './pandora.manifest.js';
import { PandoraSession, PandoraWebError } from './pandora.session.js';

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

/** What `v1/playback/source` answers: the item it put on, and the source it is playing from. */
interface PlaybackReply {
    item?: {
        type?: string;
        pandoraId?: string;
        index?: number;
        audioUrl?: string;
        encoding?: string;
        trackToken?: string;
    };
    source?: { pandoraId?: string };
}

/** Where a served copy sits in Pandora's idea of what this device is playing, kept for its reports. */
interface Served {
    sourceId: string;
    index: number;
    trackToken: string;
}

/** The storage key holding the device id Pandora knows this station by. */
const DEVICE_KEY = 'deviceUuid';

const MIME_TYPES: Record<string, string> = { aacplus: 'audio/mp4', aac: 'audio/mp4', mp3: 'audio/mpeg' };

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
    /** Each served copy's place in Pandora's playback, newest last, so its reports can name it. */
    private readonly served = new Map<string, Served>();
    /** Each track's album, which is the source a chosen record is played from. Never changes. */
    private readonly albums = new Map<string, string>();

    protected async onLoad(): Promise<void> {
        const config = configSchema.parse(await this.host.config.get());
        const password = await this.host.secrets.get('password');
        if (!password) throw new PluginError('Pandora password is not configured').withCode('config');

        this.session = new PandoraSession(config.email, password);
        this.register(() => {
            this.session?.reset();
            this.served.clear();
        });
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

    // --- stream --------------------------------------------------------------

    /**
     * A chosen record's audio: played from its album, starting at it, which is how Pandora's own app
     * plays one record on demand. Pandora answers with a signed CDN URL that needs no headers, which
     * the station downloads at once.
     *
     * Three refusals are told apart, because the station treats them differently:
     *
     * - The account cannot play chosen records (`NO_ENTITLEMENTS`, a free or Plus account), or this
     *   record has no on-demand rights: `forbidden`, about the record, which counts toward the station
     *   giving up on the copy and never against the plugin's health.
     * - The account is playing on another device: `unavailable` with a wait, which the station
     *   takes as the account being busy rather than the record being bad.
     * - Pandora put on something other than the record asked for: `upstream`, because airing it
     *   under the wrong title is worse than not airing it.
     */
    async resolveStreamUrl(trackId: string): Promise<ProviderStream | undefined> {
        if (!trackId.startsWith('TR:')) return undefined;
        const host = this.host;
        const session = this.require();

        const albumId = await this.albumOf(host, trackId);
        const deviceUuid = await this.deviceUuid(host);

        let reply: PlaybackReply;
        try {
            reply = await session.web<PlaybackReply>(host, 'v1/playback/source', {
                sourceId: albumId,
                itemId: trackId,
                deviceUuid,
                includeItem: true,
                includeSource: true,
                skipExplicitCheck: true,
            });
        } catch (error) {
            if (error instanceof PandoraWebError && error.errorString === 'NO_ENTITLEMENTS') {
                throw new PluginError('Pandora will not play a chosen record on this account; that takes Pandora Premium').withCode('forbidden');
            }
            throw error;
        }

        const item = reply.item;
        if (item?.type === 'SimStreamViolation') {
            throw new PluginError('Pandora is playing on another device on this account').withCode('unavailable').withRetry(BUSY_RETRY_MS);
        }
        if (!item?.audioUrl) throw new PluginError(`Pandora gave no audio for ${trackId}`).withCode('not_found');
        if (item.pandoraId !== undefined && item.pandoraId !== trackId) {
            throw new PluginError(`Pandora put on ${item.pandoraId} when asked for ${trackId}`).withCode('upstream');
        }

        if (item.trackToken !== undefined) this.remember(trackId, { sourceId: reply.source?.pandoraId ?? albumId, index: item.index ?? 0, trackToken: item.trackToken });

        // Pandora sometimes hands out a plain-http CDN link for audio it also serves over TLS.
        const url = item.audioUrl.startsWith('http:') ? `https:${item.audioUrl.slice(5)}` : item.audioUrl;
        const mimeType = item.encoding === undefined ? undefined : MIME_TYPES[item.encoding];
        return { url, ...(mimeType === undefined ? {} : { mimeType }) };
    }

    /**
     * Tell Pandora what became of a copy it served, the way its own player does: `trackStarted` with
     * the track's token when it goes to air, and `event/ended` with how many seconds went out when it
     * comes off.
     *
     * Reported against the place the copy was SERVED from, which Pandora accepts even once the device
     * has moved on to later records (the station fetches several ahead of air). A copy this instance
     * never served, such as one fetched before a restart, has nothing to report against and is left.
     */
    async reportPlayback(trackId: string, report: PlaybackReport): Promise<void> {
        const served = this.served.get(trackId);
        if (served === undefined) return;
        const host = this.host;
        const session = this.require();

        if (report.event === 'started') {
            await session.web(host, 'v1/station/trackStarted', { trackToken: served.trackToken });
            return;
        }

        await session.web(host, 'v1/event/ended', {
            deviceUuid: await this.deviceUuid(host),
            sourceId: served.sourceId,
            index: served.index,
            elapsedTime: Math.round((report.elapsedMs ?? 0) / 1000),
            reason: 'NORMAL',
        });
        this.served.delete(trackId);
    }

    // --- helpers -------------------------------------------------------------

    /** A track's album id, asked of Pandora once and kept, since it never changes. */
    private async albumOf(host: PluginHost, trackId: string): Promise<string> {
        const known = this.albums.get(trackId);
        if (known !== undefined) return known;

        const track = (await this.annotate(host, [trackId]))[trackId];
        if (track === undefined) throw new PluginError(`Pandora has no record ${trackId}`).withCode('not_found');
        if (track.rightsInfo?.hasInteractive === false) throw new PluginError(`Pandora cannot play ${trackId} on demand`).withCode('forbidden');
        if (!track.albumId) throw new PluginError(`Pandora gave no album for ${trackId}`).withCode('not_found');

        this.albums.set(trackId, track.albumId);
        return track.albumId;
    }

    /** The id this station is known to Pandora by, made the first time and kept. */
    private async deviceUuid(host: PluginHost): Promise<string> {
        const stored = await host.storage.get(DEVICE_KEY);
        if (typeof stored === 'string' && stored !== '') return stored;

        const made = crypto.randomUUID();
        await host.storage.set(DEVICE_KEY, made);
        return made;
    }

    /** Keep a served copy's place, forgetting the oldest once there are more than its reports need. */
    private remember(trackId: string, served: Served): void {
        this.served.delete(trackId);
        this.served.set(trackId, served);
        while (this.served.size > SERVED_MEMORY) this.served.delete(this.served.keys().next().value!);
    }

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
