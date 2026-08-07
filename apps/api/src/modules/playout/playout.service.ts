import { timingSafeEqual } from 'node:crypto';
import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import { TracksRepository } from '#modules/catalog/tracks.repository.js';
import { PlaylistsService } from '#modules/playlists/playlists.service.js';
import type { CatalogTrack } from '#modules/playlists/types/playlists.types.js';
import { StreamService } from '#modules/stream/stream.service.js';
import { PlayoutControlClient } from './liquidsoap.control.js';
import { LiquidsoapEndpoint } from './liquidsoap.endpoint.js';
import { PlayoutPusher } from './playout.pusher.js';
import { Rundown, type RundownItem, type RundownTrack } from './rundown.js';
import type {
    PlayoutAiredQuery,
    PlayoutBridgeHeaders,
    PlayoutItem,
    PlayoutPlaylistInput,
    PlayoutStatus,
} from './types/playout.types.js';

/**
 * How much of the running order a status answer carries.
 *
 * The console shows what is coming, not the whole order: a playlist can be
 * hundreds of tracks, and this is polled every couple of seconds.
 */
const UP_NEXT_LIMIT = 10;

/**
 * The playout surface: the console's transport, plus the one call the stream
 * container makes inbound.
 *
 * The console half reads and drives the running order. The container half is
 * Liquidsoap confirming what went on air, which never reaches a browser and is
 * not in the SDK.
 */
@Injectable()
export class PlayoutService {
    constructor(
        private readonly rundown: Rundown,
        private readonly pusher: PlayoutPusher,
        private readonly playlists: PlaylistsService,
        private readonly tracks: TracksRepository,
        private readonly endpoint: LiquidsoapEndpoint,
        private readonly control: PlayoutControlClient,
        private readonly stream: StreamService,
        private readonly logger: Logger,
    ) {}

    /**
     * The transport, as one reading.
     *
     * `nowPlaying` is what the PLAYER reports, not what was last handed to it:
     * an item is pushed and downloaded an item ahead of air, so the two differ
     * by a whole track for most of a track's length.
     */
    async getStatus(): Promise<PlayoutStatus> {
        const nowPlaying = this.rundown.nowPlaying();
        // Includes the item the player is already holding, which is the one that
        // actually airs next. Counted from the same list, so `queuedCount` and
        // `upNext` can never disagree about what is coming.
        const upcoming = this.rundown.upcoming();
        // The mount is a setting, so the console follows it rather than keeping a second
        // copy that drifts. A PATH, not a URL: `stream.icecastHost` names Icecast as the
        // app's containers see it, which is not an address a browser can reach.
        const { mount } = await this.stream.settings();

        return {
            mountPath: mount,
            // Reachability is the honest answer to "can anything air right now".
            // A running order with no stream to hand it to plays nothing, and a
            // console that showed a queue without saying so would be lying by omission.
            //
            // Read from the last call the transport actually made, not from resolving
            // an address: a pinned LIQUIDSOAP_CONTROL_URL resolves without being
            // probed, so asking the endpoint would report any configured stream as up.
            streamUp: this.control.isUp(),
            // Whether any of it is being HEARD. The rundown can be full and the stream
            // reachable while the mount airs silence, because holding it is a lease the
            // app renews — so this is the one field that answers "are we broadcasting".
            onAir: this.control.isOnAir(),
            ...(nowPlaying
                ? {
                      nowPlaying: {
                          item: toPlayoutItem(nowPlaying.item),
                          startedAt: nowPlaying.startedAt,
                          ...(nowPlaying.remainingMs === undefined ? {} : { remainingMs: nowPlaying.remainingMs }),
                      },
                  }
                : {}),
            upNext: upcoming.slice(0, UP_NEXT_LIMIT).map(toPlayoutItem),
            queuedCount: upcoming.length,
        };
    }

    /**
     * Load a plugin playlist into the running order and start airing it.
     *
     * Reads the tracks through {@link PlaylistsService} rather than calling the
     * plugin directly, so the same narrowing applies as when the console lists
     * them: an actor who cannot see the plugin gets the same 403 whether or not
     * it is installed, and a plugin that is not catalog-capable answers 501
     * rather than failing halfway through a load.
     *
     * Replaces whatever was queued. What is on air finishes: changing the
     * running order is not a reason to cut the listener off mid-track.
     *
     * @throws 422 when the playlist has no tracks. Loading an empty order would
     *   report success and then silently play nothing.
     */
    async playPlaylist(input: PlayoutPlaylistInput): Promise<PlayoutStatus> {
        const { tracks } = await this.playlists.getPlaylistTracks(input.pluginId, input.playlistId);
        if (tracks.length === 0) {
            throw httpError(422).withDetails({ message: 'that playlist has no tracks to play' });
        }

        this.rundown.load(await this.toRundownTracks(input.pluginId, tracks));
        this.logger.info('playout: loaded a playlist into the running order', {
            plugin: input.pluginId,
            playlist: input.playlistId,
            tracks: tracks.length,
        });

        // Hand the first item over now rather than waiting out the reconcile tick,
        // so the console's own response already reflects a station that is starting.
        await this.pusher.reconcile();
        return this.getStatus();
    }

    /**
     * End the item on air so the next one starts at once.
     *
     * @throws 409 when the stream did not take the command, so a skip nobody
     *   heard is never reported as one that happened.
     */
    async skip(): Promise<PlayoutStatus> {
        if (!(await this.pusher.skipCurrent())) {
            throw httpError(409).withDetails({ message: 'the stream did not take the skip; it may be down' });
        }
        return this.getStatus();
    }

    /**
     * Drop the running order and go off air.
     *
     * Ends the broadcast rather than the running order: what is on air stops too,
     * at once. deadair holds the mount on a lease it has to keep renewing, and a
     * station standing down stops renewing it — so the audio ends with the
     * command instead of a track later, and the mount goes quiet rather than
     * falling through to a local bed nobody programmed.
     */
    async stop(): Promise<PlayoutStatus> {
        // The reset listener in the pusher is what hands the mount back.
        this.rundown.reset();
        this.logger.info('playout: standing down; the running order is dropped and the mount goes quiet');
        return this.getStatus();
    }

    /**
     * Record the item Liquidsoap has just put on air.
     *
     * Answers 204 even for an id the rundown does not know. The caller is a
     * fire-and-forget `http.post` inside the streaming script that cannot act on
     * a failure, and an unknown id is an ordinary event rather than an error: it
     * is what a Liquidsoap that outlived an app restart reports for the item it
     * is still playing. {@link Rundown.markAired} declines to invent it into the
     * running order, which is the whole handling it needs.
     *
     * @throws 404 while the bridge secret is unseeded (the route is not usable
     *   yet), 401 when the presented secret does not match.
     */
    async confirmAired(query: PlayoutAiredQuery, headers: PlayoutBridgeHeaders): Promise<void> {
        this.requireBridgeSecret(headers['x-playout-secret']);

        if (!this.rundown.markAired(query.item)) {
            this.logger.warn('playout: aired notify named an item the rundown does not hold', { item: query.item });
        }
    }

    /**
     * One provider's playlist as running-order items, with whatever the local
     * catalog can add to them.
     *
     * A provider describes the copy it will serve, and that stays authoritative
     * for title, artists and duration: it is the thing that will actually play.
     * The catalog knows the WORK — its canonical id, its release year, and a cover
     * the station has already cached — and none of that reaches a console
     * otherwise, which is why the mount and the transport bar have been unlabelled.
     *
     * Cover art prefers the catalog's answer because {@link artUrl} has already
     * resolved it to the local copy where one exists; the provider's URL is the
     * fallback for a track the catalog has never seen.
     *
     * Never fails the load. Metadata is decoration and airing is the job, so a
     * catalog read that throws costs the covers and nothing else.
     */
    private async toRundownTracks(pluginId: string, tracks: readonly CatalogTrack[]): Promise<RundownTrack[]> {
        const known = await this.catalogMetadata(pluginId, tracks);

        return tracks.map(track => {
            const row = known.get(track.id);
            const album = track.album ?? row?.albumName ?? undefined;
            const artworkUrl = row?.albumImageUrl ?? track.artworkUrl;
            return {
                pluginId,
                externalId: track.id,
                title: track.title,
                artists: track.artists,
                ...(track.durationMs === undefined ? {} : { durationMs: track.durationMs }),
                ...(album === undefined ? {} : { album }),
                ...(artworkUrl == null ? {} : { artworkUrl }),
                ...(row?.year == null ? {} : { year: row.year }),
                ...(row?.trackId === undefined ? {} : { trackId: row.trackId }),
            };
        });
    }

    /** The catalog's rows for these bindings, by provider id. Empty when the catalog cannot answer. */
    private async catalogMetadata(pluginId: string, tracks: readonly CatalogTrack[]) {
        try {
            const rows = await this.tracks.findByBindings(
                pluginId,
                tracks.map(track => track.id),
            );
            return new Map(rows.map(row => [row.externalId, row]));
        } catch (error) {
            this.logger.warn('playout: could not read catalog metadata for a playlist; airing it without', {
                plugin: pluginId,
                error: error instanceof Error ? error.message : String(error),
            });
            return new Map();
        }
    }

    /**
     * Gate an internal call on the shared bridge secret.
     *
     * Constant-time, because this is a bare secret compared on every boundary:
     * a length-then-bytes short circuit leaks it a byte at a time to anything
     * that can time the response.
     */
    private requireBridgeSecret(presented: string): void {
        const expected = this.endpoint.secret();
        if (!expected) {
            // Not seeded, so nothing could match. 404 rather than 401: the route is
            // not merely refusing this caller, it cannot serve anyone yet.
            throw httpError(404).withDetails({ message: 'the playout bridge is not configured' });
        }
        if (!safeEqual(presented, expected)) {
            throw httpError(401).withDetails({ message: 'invalid playout bridge secret' });
        }
    }
}

/** The response view of a rundown item. Everything on it is already JSON-safe. */
function toPlayoutItem(item: RundownItem): PlayoutItem {
    return {
        id: item.id,
        pluginId: item.pluginId,
        externalId: item.externalId,
        title: item.title,
        artists: item.artists,
        ...(item.durationMs === undefined ? {} : { durationMs: item.durationMs }),
        ...(item.album === undefined ? {} : { album: item.album }),
        ...(item.artworkUrl === undefined ? {} : { artworkUrl: item.artworkUrl }),
        ...(item.year === undefined ? {} : { year: item.year }),
        ...(item.trackId === undefined ? {} : { trackId: item.trackId }),
    };
}

/** Constant-time compare that tolerates differing lengths. */
function safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    // timingSafeEqual throws on a length mismatch, and the length is not the secret.
    return left.length === right.length && timingSafeEqual(left, right);
}
