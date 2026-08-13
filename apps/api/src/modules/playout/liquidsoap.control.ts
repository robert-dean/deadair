import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { StreamConfigWatch } from '#modules/stream/stream.staleness.js';
import { LiquidsoapEndpoint } from './liquidsoap.endpoint.js';

/**
 * Client for the playout control endpoints in `stream/radio.liq`: the app's half
 * of the push model.
 *
 * Everything is best-effort — an unreachable stream resolves to `undefined` or
 * `false` rather than throwing — because the caller ({@link PlayoutPusher}) runs
 * on a reconcile loop, and a stream that is down is a normal state rather than
 * an error. A failed call invalidates the endpoint so the next one re-probes
 * instead of retrying an address that has gone away.
 */

/** Local calls against an in-memory queue; a live Liquidsoap answers in milliseconds. */
const CONTROL_TIMEOUT_MS = 2000;

/**
 * How long one {@link PlayoutControlClient.assertOnAir} keeps the station on air,
 * in seconds. Materialized into `radio.env` as `CONTROL_TTL_S`, so both ends of
 * the lease come from this one number.
 *
 * The station airs NOTHING unless the app is actively renewing this. That makes
 * the value a real trade: too short and an ordinary slow tick drops the mount,
 * too long and a dead app keeps broadcasting for that many seconds. Six is three
 * of the pusher's two-second reconciles, which is enough to ride out a slow one
 * and short enough that a crash is over before a listener has decided what they
 * are hearing.
 */
export const CONTROL_TTL_S = 6;

/**
 * How many items beyond the one on air the station keeps ready, in both senses:
 * how many the app hands over ({@link PlayoutPusher}'s lead) and how many
 * Liquidsoap RESOLVES ahead (`request.queue(prefetch=…)`, materialized into
 * `radio.env`). One number, because the two are useless apart — pushing items
 * Liquidsoap will not resolve buys nothing, and a prefetch with nothing pushed
 * has nothing to resolve.
 *
 * This is what makes a skip land at once. `prefetch` defaults to 1, so exactly
 * one track is ever downloaded ahead; a skip spends it, and a second skip before
 * the replacement finishes downloading has nothing resolved to cut to. Measured
 * on a real station, that is the difference between a ~200ms skip and one that is
 * either seconds late or silently swallowed.
 *
 * Three, so an operator can click through a few tracks and each one lands. The
 * cost is real but small: three tracks fetched ahead rather than one, which is
 * disk and upstream traffic in the stream container. Raising it further buys
 * deeper clicking and commits the running order further ahead.
 */
export const PLAYOUT_LEAD = 3;

/**
 * What Liquidsoap reports about its playout queue: `radio.liq`'s `playout_reading`.
 *
 * Everything past `queued` is optional because a running Liquidsoap may be on an
 * older script — the app deploys independently of the container. Absent means
 * "not reported", never "zero".
 */
export interface QueueStatus {
    /**
     * Requests waiting, EXCLUDING the one on air: both the pending queue and the
     * one already resolved (downloaded) by the prefetch. The depth the pusher
     * tops up against.
     */
    queued: number;
    /**
     * Whether the queue is actually producing audio. False means the mount has
     * fallen through to another bed, so nothing in the running order is being
     * heard — the only positive signal that an item ENDED, which a boundary
     * never gives (it only ever says a new one started).
     */
    ready?: boolean;
    /** Rundown item id on air, per the queue's own track boundary. Absent when nothing is. */
    onAir?: string;
    /**
     * Milliseconds left of the item on air, or `undefined` when the decoder
     * cannot say. This is the decoder's position, so it leads the listener by the
     * encoder and client buffers.
     */
    remainingMs?: number;
    /**
     * Whether deadair's lease is unexpired, so the programme is actually reaching
     * the mount.
     *
     * Every other field describes the QUEUE, which keeps playing whether or not
     * the gate above it is open. This one describes the STATION. Absent means an
     * older `radio.liq` that has no gate at all, which is not the same as false —
     * see {@link PlayoutControlClient.isOnAir}.
     */
    driving?: boolean;
    /**
     * What the armed talk-over cue is doing.
     *
     *   `idle`   nothing armed
     *   `armed`  waiting for its record to reach the moment
     *   `fired`  pushed to the voice queue
     *   `missed` its record ended, or was skipped, before the moment arrived
     *
     * `missed` is the one worth reading. A cue that expired is invisible from
     * outside by construction — nothing was heard, and nothing failed — so without
     * this the station would drop breaks silently and the only symptom would be a
     * DJ that talks less than it should.
     */
    voice?: VoiceCueState;
    /**
     * The generation of `radio.env` the running Liquidsoap booted with, as the
     * app's materializer stamped it.
     *
     * Absent from a script too old to report one, which is not a mismatch: see
     * `StreamConfigWatch`, which is the only thing that reads this.
     */
    configStamp?: string;
}

/** See {@link QueueStatus.voice}. */
export type VoiceCueState = 'idle' | 'armed' | 'fired' | 'missed';

const VOICE_STATES: readonly string[] = ['idle', 'armed', 'fired', 'missed'];

@Injectable()
export class PlayoutControlClient {
    /** Whether the last call to the stream actually got an answer. See {@link isUp}. */
    private up = false;
    /** Whether the last reading said the station was on air. See {@link isOnAir}. */
    private onAir = false;
    /** When the running order stopped producing, while it is still stopped. See {@link starvedSince}. */
    private starvedAt?: number;

    constructor(
        private readonly endpoint: LiquidsoapEndpoint,
        // Fed, not consulted. Every reading carries the config generation the running
        // Liquidsoap booted with, and this loop is already asking twice a second — a
        // second client asking the same question would be a second answer to disagree
        // with. See `stream.staleness.ts`.
        private readonly staleness: StreamConfigWatch,
        private readonly logger: Logger,
    ) {}

    /**
     * Whether the stream answered the most recent call.
     *
     * Deliberately the outcome of a real call rather than
     * {@link LiquidsoapEndpoint.resolve}: a configured `LIQUIDSOAP_CONTROL_URL`
     * is returned unprobed (it is a pin, not a guess), so resolving one would
     * report a stream as reachable purely because an operator named an address.
     *
     * Never more than one reconcile tick stale, because the pusher's loop is
     * itself a call. False before the first one, which is the honest answer:
     * nothing has been heard from yet.
     */
    isUp(): boolean {
        return this.up;
    }

    /**
     * Whether the station was actually broadcasting deadair's programme as of the
     * last reading.
     *
     * Different from {@link isUp} in the way that matters most: a reachable stream
     * with an expired lease is up and NOT on air, playing silence to whoever is
     * connected. It is also different from having something queued, because the
     * lease is what turns a running order into audio.
     *
     * False before the first reading, and false against a `radio.liq` too old to
     * report it. Both are the safe answer: a console that cannot confirm the
     * station is on air should not claim it is.
     */
    isOnAir(): boolean {
        return this.onAir;
    }

    /**
     * When the mount fell through to Liquidsoap's local bed, if it is still there.
     *
     * The only state here that the app cannot observe for itself: the reconcile loop
     * looks every couple of seconds, so a gap shorter than that never appears in a
     * reading at all. Liquidsoap pushes it instead, through
     * `POST /playout/bridge/starve`.
     *
     * It lives on this class because a starve is a fact about what the PLAYER is
     * doing, alongside {@link isUp} and {@link isOnAir}, and because those are all
     * singletons while `PlayoutService` is scoped per request — a starve recorded
     * there would be forgotten as soon as the request that heard about it ended.
     */
    starvedSince(): number | undefined {
        return this.starvedAt;
    }

    /**
     * The running order stopped producing audio, or started again.
     *
     * The leading edge does not overwrite an earlier one, so what is reported is how
     * long the mount has been on the bed rather than how long since the last message
     * about it. Liquidsoap repeats the state rather than sending strictly alternating
     * edges.
     */
    noteStarve(starved: boolean, now = Date.now()): void {
        if (!starved) this.starvedAt = undefined;
        else this.starvedAt ??= now;
    }

    /** One reading of the queue, or `undefined` when the stream is not reachable. */
    async status(): Promise<QueueStatus | undefined> {
        return this.read(await this.call('GET', '/control/status'));
    }

    /**
     * Renew deadair's claim on the mount, and take a reading while we are there.
     *
     * The station is gated on this: `radio.liq` airs the programme only while an
     * assertion is unexpired, so everything the operator hears exists because
     * this call keeps happening. It replaces {@link status} on the reconcile loop
     * rather than joining it, so holding the station costs no extra request.
     *
     * Deliberately not something the app can set once. A lease has to be renewed
     * by something that is still running, which is exactly the property a flag
     * would not have: a crashed app leaves a flag set.
     */
    async assertOnAir(): Promise<QueueStatus | undefined> {
        return this.read(await this.call('POST', '/control/onair'));
    }

    /**
     * Hand the mount back at once: the station goes off air without waiting out
     * {@link CONTROL_TTL_S}, and Liquidsoap drops what it was holding.
     *
     * For a deliberate stop. Letting the lease lapse would put several seconds of
     * audio after a command the operator has already given, which is the kind of
     * lag that makes a console feel like it is not really in charge.
     */
    async releaseOnAir(): Promise<QueueStatus | undefined> {
        return this.read(await this.call('POST', '/control/offair'));
    }

    /**
     * Label the mount with what is airing right now.
     *
     * Belt and braces over the `annotate:` metadata already on the pushed uri,
     * and not redundant: annotations ride a track boundary, and the two switches
     * between the queue and the output move mid-track by design (`radio.liq`,
     * `control_metadata`). A packet emitted while another branch is selected is
     * dropped, which is measurable as a mount announcing a track that ended
     * several songs ago.
     *
     * Best-effort like everything else here. A label that did not land is a
     * cosmetic fault on a station that is still playing the right audio, and it
     * must never interrupt the boundary it was triggered by.
     */
    async announce(label: string): Promise<boolean> {
        const line = oneLine(label);
        return line ? !!(await this.call('POST', '/control/metadata', line)) : false;
    }

    /** Push one `annotate:` uri onto the queue. False when it did not land. */
    async push(uri: string): Promise<boolean> {
        return !!(await this.call('POST', '/control/push', uri));
    }

    /**
     * Line a segment up to play OVER a record, `atMs` into it.
     *
     * The station does not decide when the DJ speaks; this says what to say and
     * against which item, and `radio.liq` picks the instant. That is the whole
     * design and not a detail: the elapsed time is measured in the streaming loop,
     * where it carries no error from this process's clock, from this round trip,
     * or from the buffers between the decoder and the listener.
     *
     * One cue is held at a time, so a second arm replaces the first. That is why
     * this is called as each item is handed over rather than for a whole batch.
     *
     * The cue is carried in headers because the script parses none: `list.assoc`
     * over the request headers is a primitive it already uses for its own secret.
     */
    async armVoice(uri: string, itemId: string, atMs: number): Promise<boolean> {
        return !!(await this.call('POST', '/control/voice/arm', uri, {
            'X-Voice-Item': itemId,
            'X-Voice-At-Ms': String(Math.max(0, Math.round(atMs))),
        }));
    }

    /** Forget an armed cue. What a stand-down needs: its record is not going to air. */
    async clearVoice(): Promise<boolean> {
        return !!(await this.call('POST', '/control/voice/clear'));
    }

    /**
     * Drop everything queued but not yet airing. What is on air finishes: the
     * station stops committing to a running order it has abandoned, it does not
     * cut the listener off mid-track.
     *
     * Answers with the reading the command produced, or `undefined` when the
     * stream did not take it. Every `/control/*` endpoint returns the same
     * reading as `/control/status`, so a mutation's own response is already the
     * state it produced and the caller does not have to go and ask.
     */
    async flush(): Promise<QueueStatus | undefined> {
        return this.read(await this.call('POST', '/control/flush'));
    }

    /**
     * End the item on air so the queue advances immediately — the operator skip.
     * The opposite of {@link flush}: this one is only about what is playing and
     * leaves the running order behind it untouched.
     *
     * Like {@link flush}, answers with the reading rather than a bare boolean.
     * That reading may still name the item that was cut: `playout_queue.skip()`
     * advances in Liquidsoap's streaming loop, not in the request that asked for
     * it, so the boundary can land after the response is built. Confirming it is
     * {@link PlayoutPusher.skipCurrent}'s job.
     */
    async skip(): Promise<QueueStatus | undefined> {
        return this.read(await this.call('POST', '/control/skip'));
    }

    /**
     * Parse one reading and remember what it said about the station.
     *
     * Every reading-returning call funnels through here, so {@link isOnAir} is as
     * fresh as the last thing the app did — and a call that failed leaves it
     * false rather than stale, because a stream we cannot reach is not a stream
     * we can claim to be broadcasting on.
     */
    private read(body: unknown): QueueStatus | undefined {
        const reading = parseReading(body);
        this.onAir = reading?.driving ?? false;
        // A call that produced no reading hands over `undefined` rather than a default:
        // a stream nobody could reach has not told us anything about its config, and the
        // watch must not accuse it on the strength of a failed request.
        this.staleness.noteLiquidsoap(
            reading === undefined
                ? undefined
                : { ...(reading.configStamp === undefined ? {} : { stamp: reading.configStamp }), driving: reading.driving ?? false },
        );
        return reading;
    }

    /** One control call. Resolves to the parsed JSON body, or `undefined` on any failure. */
    private async call(method: 'GET' | 'POST', path: string, body?: string, extra?: Record<string, string>): Promise<unknown> {
        const base = await this.endpoint.resolve();
        if (!base) {
            // Nothing answered the probe, so there is no address to be up at.
            this.up = false;
            return undefined;
        }

        try {
            const response = await fetch(`${base}${path}`, {
                method,
                headers: {
                    'X-Playout-Secret': this.endpoint.secret(),
                    ...(body === undefined ? {} : { 'Content-Type': 'text/plain' }),
                    ...extra,
                },
                body,
                signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
            });

            if (!response.ok) {
                // 401 means the secret diverged (Liquidsoap still on a stale radio.env);
                // anything else is a bug in the handler. Both are worth saying out loud.
                // Not "down": something answered, it just refused — and a console that
                // said the stream was unreachable would send the operator looking for
                // the wrong fault.
                this.up = true;
                this.logger.warn(`liquidsoap: ${method} ${path} answered ${response.status}`);
                return undefined;
            }
            this.up = true;
            return (await response.json()) as unknown;
        } catch (error) {
            // Unreachable, timed out, or a body that is not JSON: the stream may have
            // restarted, so drop the cached address and let the next call re-probe.
            this.up = false;
            this.endpoint.invalidate();
            this.logger.warn(`liquidsoap: ${method} ${path} failed (${errorText(error)})`);
            return undefined;
        }
    }
}

/**
 * Parse one `playout_reading` body.
 *
 * `queued` is required — a body without it is not a reading at all, which is how
 * a 401 page or some other service on the port is rejected. Everything else is
 * dropped unless it is present AND well-formed, so a partial answer degrades to
 * "not reported" instead of a confident wrong number.
 *
 * Exported for tests: this is the whole compatibility boundary between the app
 * and the stream.
 */
export function parseReading(body: unknown): QueueStatus | undefined {
    if (!body || typeof body !== 'object') return undefined;

    const raw = body as Record<string, unknown>;
    const queued = Number(raw.queued);
    if (!Number.isFinite(queued)) return undefined;

    const status: QueueStatus = { queued };
    if (typeof raw.ready === 'boolean') status.ready = raw.ready;
    if (typeof raw.driving === 'boolean') status.driving = raw.driving;
    // "" is radio.liq's "nothing on air", not an id.
    if (typeof raw.onAir === 'string' && raw.onAir !== '') status.onAir = raw.onAir;
    // radio.liq sends -1 for "cannot say". A 0 would mean an item with no time left,
    // which is never actionable: the boundary that proves it is a moment away.
    const remaining = Number(raw.remainingMs);
    if (Number.isFinite(remaining) && remaining > 0) status.remainingMs = remaining;
    // Absent from a Liquidsoap on an older script, which is not an error: everything else in the
    // reading is still true, and the app simply cannot see the cue.
    if (typeof raw.voice === 'string' && VOICE_STATES.includes(raw.voice)) status.voice = raw.voice as VoiceCueState;
    // "" is radio.liq's "the app that rendered my config did not stamp it", which is
    // the same answer as an older script: no evidence, rather than a generation of "".
    if (typeof raw.configStamp === 'string' && raw.configStamp !== '') status.configStamp = raw.configStamp;
    return status;
}

/**
 * Flatten a label to the one line the metadata endpoint reads, because that is
 * the whole body: a newline in a track title would otherwise truncate it.
 */
const oneLine = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim();

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
