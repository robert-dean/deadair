import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { DirectorConsoleService } from '#modules/director/director.console.service.js';
import { StreamService } from '#modules/stream/stream.service.js';
import { StreamConfigWatch } from '#modules/stream/stream.staleness.js';
import { TrackAudioService } from './audio/track.audio.service.js';
import type { TrackContentType } from './audio/track.store.js';
import { AudienceWatch } from './audience.watch.js';
import { PlayoutControlClient } from './liquidsoap.control.js';
import { LiquidsoapEndpoint } from './liquidsoap.endpoint.js';
import { PlayoutPusher, RECONCILE_TICK_MS } from './playout.pusher.js';
import { Rundown, type RundownItem } from './rundown.js';
import { diagnose } from './silence.diagnosis.js';
import type {
    PlayoutAiredQuery,
    PlayoutItem,
    PlayoutPlaylistInput,
    PlayoutStarveQuery,
    PlayoutStatus,
    SilenceCause,
    StationSilence,
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
 * How long a record's audio may be held by whatever fetched it.
 *
 * A day, matching the segment audio route, and safe for the same reason: the URL is keyed by the
 * binding and the ETag is the checksum, so a re-fetched copy revalidates rather than being served
 * stale. In practice the only client is Liquidsoap, which downloads each item once.
 */
const TRACK_CACHE_CONTROL = 'public, max-age=86400';

/**
 * What the track audio route hands the generated router.
 *
 * `contentType` is the answer rather than decoration, exactly as it is for segment audio: the
 * operation declares every format the store holds and the router sets `ctx.type` from whichever
 * this names. Liquidsoap picks its decoder from that header, so it is the difference between a
 * flac that plays and one that silently does not.
 */
export interface TrackAudioResponse {
    contentType: TrackContentType;
    body: Buffer;
    headers: { cacheControl: string; etag: string };
}

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
        // Where a record's audio comes from, disk or provider. The one route below is its only
        // request-path caller.
        private readonly trackAudio: TrackAudioService,
        // Whether the containers are running the config that was rendered for them.
        // It rides the transport status because that is the reading the console already
        // polls and the card it draws is where an operator looks when nothing is being
        // heard — which is the exact symptom this warning explains.
        private readonly staleness: StreamConfigWatch,
        // The durable half of the same sentence the logger gets below. Injected here rather than
        // reached for at the call site because the edge this service already computes is the only
        // place a silence is worth writing down.
        private readonly activity: ActivityRecorder,
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
        const silence = await this.diagnoseSilence();

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
            // The one field composed from all the others' sources rather than reported from
            // one of its own. Every field above answers for a single gate, which is why a
            // console reading them alone had to guess: `onAir` false with `audience` false
            // is a station waiting for a listener, unless Icecast stopped answering, in
            // which case it is a station that will wait forever.
            silence,
        };
    }

    /**
     * Compose every gate into one answer, and say so once when it changes.
     *
     * The gathering is all of it: the ordering lives in `diagnose`, which is a pure
     * function precisely so this method can be the boring half.
     *
     * `getAir` is the only database read here, and it is the one fact that is not in
     * memory: whether the station was stood down. Worth a row read per poll because
     * without it "nothing to air" cannot be told from "somebody stopped it", which are
     * the two most common reasons for a quiet station and want opposite responses.
     */
    private async diagnoseSilence(): Promise<StationSilence> {
        const now = Date.now();
        const air = await this.director.getAir();
        const health = this.pusher.health(now);
        const audience = this.audience.reading();
        const starvedSince = this.control.starvedSince();
        const deniedSince = this.control.deniedSince();
        const audioWaitSince = this.director.audioWaitSince();

        const silence = diagnose({
            now,
            ...(health.stalledForMs === undefined ? {} : { reconcileStalledForMs: health.stalledForMs }),
            ...(health.failure === undefined ? {} : { reconcileFailure: health.failure }),
            streamUp: this.control.isUp(),
            ...(deniedSince === undefined ? {} : { controlDeniedForMs: now - deniedSince }),
            driving: this.control.isOnAir(),
            staleConfig: this.staleness.warnings(),
            active: air.active,
            hasProgramme: this.rundown.hasProgramme(),
            // Read from the director rather than derived here, because "the order is full and cold"
            // is a fact about the commit pass and nothing this service can see says it: an order
            // that ran out and one whose records are still being fetched both leave the transport
            // holding nothing.
            ...(audioWaitSince === undefined ? {} : { audioWaitForMs: now - audioWaitSince }),
            airMode: air.airMode,
            listeners: audience.count,
            audience: audience.hasAudience,
            ...(starvedSince === undefined ? {} : { starvedForMs: now - starvedSince }),
        });

        this.announceSilence(silence);
        return silence;
    }

    /**
     * Say the cause, once, when it changes: to the log, and to the activity feed.
     *
     * The console polls this twice a second between them, so the only thing worth
     * writing down is the EDGE — the same treatment `StreamConfigWatch` gives its own
     * warnings, and for the same reason. This is what makes "why was the station quiet
     * at 3am" answerable at all: the diagnosis itself deliberately stores nothing,
     * because a stored copy of a live gate is a second thing that can disagree with the
     * gate, so the only durable trace of a silence is the moment it started.
     *
     * The row carries the diagnosis's OWN sentence rather than a second phrasing of the
     * same fact, which is why `detail` is passed through untouched.
     *
     * The state is static rather than per-instance because this service is scoped per
     * request: an instance field would be a fresh `undefined` on every poll and every
     * single one of them would look like a change.
     */
    private announceSilence(silence: StationSilence): void {
        if (silence.cause === PlayoutService.lastCause) return;
        PlayoutService.lastCause = silence.cause;

        if (silence.audible) this.logger.info('playout: the station is airing');
        else this.logger.info(`playout: the station is silent (${silence.cause}): ${silence.detail}`);

        // Severity comes from the gate that is blocking rather than from the silence itself,
        // because `waiting` is not a fault: a station idling for want of a listener and one that
        // cannot reach its stream are both silent and only one wants fixing. A feed that painted
        // the first amber would undo the argument the `ready` badge exists on.
        const blocking = silence.checks.find(check => check.code === silence.cause);
        // Voided deliberately: the recorder never throws, and a poll must not wait on a row
        // nothing reads to decide anything. See `ActivityRecorder`.
        void this.activity.record({
            module: 'playout',
            kind: 'silence.cause',
            severity: blocking?.state === 'fault' ? 'fault' : 'info',
            detail: silence.audible ? 'The station is airing.' : silence.detail,
            data: {
                cause: silence.cause,
                audible: silence.audible,
                ...(blocking?.remedy === undefined ? {} : { remedy: blocking.remedy }),
            },
        });
    }

    /** See {@link announceSilence}. One process, one station, one last-said cause. */
    private static lastCause?: SilenceCause;

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
     * Put the station back on air with the running order it already has.
     *
     * The other half of {@link stop}, and it exists because Stop deliberately keeps the order:
     * `StationAirRepository.standDown` leaves every item saying where it got to, and until this
     * route the only way back on air was `PUT /director/air`, which builds a NEW broadcast from a
     * playlist read at that moment and throws the stopped one away.
     *
     * A 409 rather than a quiet 200 when there is nothing left to resume. A station switched on and
     * holding nothing is the state the mount lease exists to avoid asserting, and an operator who
     * pressed Start needs to be told to put a playlist on instead.
     */
    async start(): Promise<PlayoutStatus> {
        const { resumed } = await this.director.resumeAir();
        if (!resumed) {
            throw httpError(409).withDetails({ message: 'there is no running order left to resume; put a playlist on air instead' });
        }

        this.logger.info('playout: starting again on the running order the station was stopped on');
        return this.getStatus();
    }

    /**
     * Go off air, leaving the running order where it is.
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
        this.logger.info('playout: standing down; the mount goes quiet and the running order is reclaimed for a resume');
        return this.getStatus();
    }

    /**
     * One record's audio, for the player to fetch.
     *
     * **The only way audio for a record reaches anything**, and the reason the transport hands out one
     * URL per item rather than choosing between the station's and the provider's. Whether the station
     * already holds these bytes is not this route's question: {@link TrackAudioService.ensure} reads
     * the file, a fetch already running, or the provider, in that order, and answers with bytes
     * either way.
     *
     * In the ordinary case the bytes are already here, because the director will not commit a record
     * whose audio is not — but this route deliberately does not ASSUME that. A URL handed to the
     * player has to keep working, and a record can legitimately arrive here cold: an item still
     * airing across a restart, or one an operator moved to the head of the order.
     *
     * A 404 is therefore a real absence: no such binding, or a provider that would not serve it. The
     * player skips the item, which is the same outcome an unresolvable item has always had.
     */
    async getTrackAudio(sourceId: string): Promise<TrackAudioResponse> {
        const served = await this.trackAudio.ensure(sourceId);
        if (served === undefined) throw httpError(404).withDetails({ message: `no audio available for track source "${sourceId}"` });

        return {
            contentType: served.contentType,
            body: served.body,
            headers: { cacheControl: TRACK_CACHE_CONTROL, etag: `"${served.checksum}"` },
        };
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
        // Recorded on the control client rather than here, because this service is scoped
        // per request: a gap remembered on it would be forgotten the moment the request
        // that heard about it ended, which is a millisecond after it arrived.
        this.control.noteStarve(query.state === 'starved');

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
            // Only the long ones reach the feed, and only on the recovery, for exactly the reason
            // the WARN is here rather than above: every first listener produces a designed ~500ms
            // gap, and a feed carrying one line per arrival is a feed nobody reads. The duration is
            // the fact, and it is not known until the gap closes.
            void this.activity.record({
                module: 'playout',
                kind: 'gap',
                severity: 'fault',
                detail: `The station aired the local bed instead of its running order for ${Math.round(query.forMs / 1000)}s.`,
                data: { gapMs: query.forMs },
            });
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
