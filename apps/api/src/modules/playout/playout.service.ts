import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import { DirectorConsoleService } from '#modules/director/director.console.service.js';
import { StreamService } from '#modules/stream/stream.service.js';
import { StreamConfigWatch } from '#modules/stream/stream.staleness.js';
import { AudienceWatch } from './audience.watch.js';
import { PlayoutControlClient } from './liquidsoap.control.js';
import { LiquidsoapEndpoint } from './liquidsoap.endpoint.js';
import { PlayoutPusher, RECONCILE_TICK_MS } from './playout.pusher.js';
import { Rundown, type RundownItem } from './rundown.js';
import type {
    PlayoutAiredQuery,
    PlayoutItem,
    PlayoutListenerQuery,
    PlayoutPlaylistInput,
    PlayoutStarveQuery,
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
 * How long a gap in the running order has to last before it is worth an
 * operator's attention.
 *
 * One pass of the pusher's reconcile loop, and taken from that constant rather
 * than restated, because the whole meaning of the threshold is "did the app get
 * a chance to fix this". A gap shorter than a tick is the queue being topped up:
 * measured on the running station, every first listener produces one of about
 * 500ms, because the app deliberately queues nothing while the audience gate is
 * shut and so takes the lease a beat before the first item lands. A gap longer
 * than a tick is one that survived the thing that was supposed to close it.
 */
const GAP_WARN_MS = RECONCILE_TICK_MS;

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
        // The station's programming lives with the director; this surface is the
        // transport, and its one write goes through there rather than around it.
        private readonly director: DirectorConsoleService,
        private readonly endpoint: LiquidsoapEndpoint,
        private readonly control: PlayoutControlClient,
        private readonly audience: AudienceWatch,
        private readonly stream: StreamService,
        // Whether the containers are running the config that was rendered for them.
        // It rides the transport status because that is the reading the console already
        // polls and the card it draws is where an operator looks when nothing is being
        // heard — which is the exact symptom this warning explains.
        private readonly staleness: StreamConfigWatch,
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
            // Who it is all for. Both fields come from the one watch, so the count the
            // console draws and the gate the station is held on can never disagree.
            listeners: this.audience.listenerCount(),
            audience: this.audience.hasAudience(),
            // Almost always empty, and worth a field on every poll anyway: when it is not
            // empty the station is failing in a way that nothing else in this reading can
            // account for — `streamUp` is true, the running order is full, and every
            // listener is being refused by a container holding secrets from before the
            // last render.
            staleStreamConfig: this.staleness.warnings(),
        };
    }

    /**
     * Play a plugin playlist: build the running order from it and go on air.
     *
     * A delegate, not an implementation. The station's programming is the
     * director's, and this route predates it — keeping a second path that wrote
     * the running order directly would give the station two writers with no idea
     * of each other, and whichever ran last would win. So the shortcut stays,
     * because it is a genuinely useful one, and it goes the long way round.
     *
     * It is now one call rather than two, because there is no import step left to
     * make: putting a playlist on air READS it, and nothing is stored in between.
     *
     * The 403/404/422/501/503 answers all still come from the same place they
     * always did: the read goes through `PlaylistsService`, which narrows on the
     * actor's view of the plugin.
     */
    async playPlaylist(input: PlayoutPlaylistInput): Promise<PlayoutStatus> {
        await this.director.putOnAir({ pluginId: input.pluginId, playlistId: input.playlistId });

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
     * Takes no secret and checks none: it is reached under `/playout/bridge/`,
     * where `bridgeSecretMiddleware` has already refused anything that did not
     * present it. See the note above that prefix in `playout.ck`.
     */
    confirmAired(query: PlayoutAiredQuery): void {
        if (!this.rundown.markAired(query.item)) {
            this.logger.warn('playout: aired notify named an item the rundown does not hold', { item: query.item });
        }
    }

    /**
     * Note a listener Icecast has just admitted, or let go.
     *
     * The one route in the app that a listener's own connection is WAITING on:
     * `listener_add` is an authentication call, and Icecast holds the client
     * until this answers. So it does no database work, takes no lock and returns
     * a constant, and the header it returns is what admits them. A refusal here
     * is a listener refused the mount, which is why the only refusal is a wrong
     * secret.
     *
     * The count is not taken from these events. They move the reading
     * optimistically so the station is on air by the time the first bytes are
     * pulled, and `AudienceWatch` re-reads Icecast a moment later for the real
     * number. A dropped event therefore costs a second of latency and nothing
     * else.
     *
     * The secret is checked before this runs, by `bridgeSecretMiddleware` on the
     * `/playout/bridge/` prefix. Icecast presents it as HTTP basic and
     * `listener.credential.middleware` moves it onto the header first, because
     * ServerKit's authentication middleware deletes Authorization before any
     * route runs.
     */
    noteListener(query: PlayoutListenerQuery): { body: string; headers: { icecastAuthUser: string } } {
        this.audience.noteArrival(query.event === 'add');
        // `1` is what Icecast reads as "this listener may have the mount"; the header
        // name is the `auth_header` option in the rendered icecast.xml, and the two have
        // to agree or every listener is refused.
        return { body: '', headers: { icecastAuthUser: '1' } };
    }

    /**
     * Note that the running order stopped producing audio, or started again.
     *
     * `starved` means the playout queue went unready while deadair still held
     * the mount, so Liquidsoap fell through to its local bed: the station is on
     * air, and what a listener hears is not what it programmed. That is a fact
     * the app cannot observe for itself with any precision — the reconcile runs
     * every couple of seconds, so a gap shorter than that never appears in a
     * reading at all — which is why the stream pushes it rather than being
     * asked.
     *
     * A starve also brings the reconcile forward, because the usual cause is a
     * queue that ran dry or an item that failed to resolve, and both are fixed
     * by handing over the next item rather than by waiting out the tick.
     * `reconcile` is idempotent and guards itself, so firing it from here costs
     * nothing when the cause was something else.
     *
     * **The severity is decided on the recovery, not on the starve**, which
     * looks backwards and is the only place the information exists. Measured on
     * the running station: every first listener produces a real ~500ms gap,
     * because the app deliberately queues nothing while the audience gate is
     * shut ({@link PlayoutPusher}'s `WARM_LEAD`), so the lease is taken a beat
     * before the first item lands. That gap is designed behaviour. Warning about
     * it at the leading edge means a WARN on every arrival, which is precisely
     * how a log line stops being read — and the leading edge cannot tell the
     * difference, because how long a gap lasts is not known when it opens.
     *
     * So the arrival is recorded quietly and the DURATION is judged: shorter
     * than a reconcile is the queue being topped up, longer is a fault nothing
     * corrected in the time it had.
     *
     * Fire and forget on the other side, so this must not throw for anything the
     * caller cannot act on. Like the rest of the bridge it takes no secret: the
     * prefix middleware has already refused anything that did not present one.
     */
    noteStarve(query: PlayoutStarveQuery): void {
        if (query.state === 'starved') {
            this.logger.debug('playout: the running order stopped producing while on air; the mount has fallen through to the local bed', {
                playingForMs: query.forMs,
            });
            void this.pusher.reconcile().catch(() => undefined);
            return;
        }

        // "The gap ended", not necessarily "it is playing again": the stream reports a recovery
        // both when the queue produces once more and when the lease is handed back under it, so
        // that a starve cannot stay open forever waiting for something that will not happen.
        if (query.forMs > GAP_WARN_MS) {
            this.logger.warn('playout: the station aired the local bed instead of its running order', { gapMs: query.forMs });
            return;
        }

        this.logger.debug('playout: a brief gap in the running order ended', { gapMs: query.forMs });
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
