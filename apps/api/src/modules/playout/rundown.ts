import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { RENDER_PLUGIN_ID } from '#modules/render/segment.source.js';
import { Epoch } from '#modules/shared/epoch.js';
import type { LiveOrder } from './live.order.js';
import type { QueueStatus } from './liquidsoap.control.js';
import { TrackResolver } from './playout.capability.js';

/**
 * The reconciler between the station's running order and the player: what has been
 * handed over, what is actually airing, and what the player turns out not to be
 * holding after all.
 *
 * **It is not a list.** It used to hold one — `queue`, `served` and `airing` were a
 * second copy of the order, minted per play — and that second copy was the last
 * place the two-jobs split survived. There is ONE ordered list now, the director's
 * {@link LiveOrder}, and an item's position in it IS its state. See
 * `docs/decisions/on-air-ownership.md`.
 *
 * The distinction the whole class is still built around is that **handing an item
 * to the player is not the same as it airing**. Liquidsoap resolves (and, for an
 * http uri, downloads) the next request while the previous one is still playing, so
 * at any moment one item is on air and one is already fetched behind it. An app that
 * treats "just handed over" as "now playing" is a full item ahead of the listener,
 * which is wrong for now-playing, for play history, and for anything that ever needs
 * to time a DJ break. `handed` and `airing` are two states, and only the player can
 * perform the second transition: either by the `on_track` notify ({@link markAired})
 * or by a reading of its queue ({@link reconcile}).
 *
 * What it keeps of its own is bookkeeping the order has no business holding: the
 * playable form of each item ({@link prepared}), when each was handed over, and the
 * playhead. All of it is memory, all of it is rebuilt in seconds, and none of it is
 * the running order.
 *
 * **Item ids are the order's own**, which is what makes a restart recoverable: the
 * app comes back, reads the row, and recognises the item Liquidsoap is still airing
 * instead of standing its clock down over an id it has never seen.
 */

export interface RundownItem {
    /**
     * The running order's own id for this item: the one stored in
     * `station_lineup.items`, the one that rides through Liquidsoap on the
     * annotation, and the one that comes back on the player's readings.
     *
     * It used to be minted here, per play, which left nothing able to answer "which
     * item is the listener actually on" across a restart — so the app could not name
     * what the player was producing and stood the clock down instead.
     */
    id: string;
    /**
     * Identity is `pluginId` + `externalId`, which is deliberately the key of
     * `deadair.track_sources (plugin_id, external_id)` — so what aired can be
     * joined back to a canonical catalog track without reshaping the item.
     */
    pluginId: string;
    externalId: string;
    title: string;
    artists: string[];
    durationMs?: number;
    album?: string;
    /** Cover art: the station's own cached copy where there is one, the provider's URL otherwise. */
    artworkUrl?: string;
    year?: number;
    /**
     * The canonical `deadair.tracks` id, when the catalog holds this track.
     *
     * Separate from the identity above rather than replacing it, because the two
     * answer different questions and only one of them can play audio: `pluginId` +
     * `externalId` is the copy a provider will actually serve, while this is the
     * work itself. Absent for anything the catalog has never seen, which is an
     * ordinary state and not a failure — a station can air a track it has not
     * ingested.
     */
    trackId?: string;
    /**
     * Something the station means to SAY over this item, rather than after it.
     *
     * Opaque here, exactly as `trackId` is: the rundown neither reads it nor acts
     * on it, it only carries it from the director (which knows an item asked for a
     * talk-over) to the pusher (which arms the cue at the moment it hands this item
     * to the player). Nothing about the running order changes — a talk-over segment
     * is never handed to the player, because it is heard ALONGSIDE a record rather
     * than between two.
     *
     * Armed at hand-over rather than at commit for a reason: `radio.liq` holds one
     * cue at a time, and the director prepares several items at once, so arming at
     * commit would have two cues overwrite each other. The pusher hands items over
     * one at a time.
     */
    voice?: { segmentId: string; atMs: number };
}

/** An item handed over, with the URL the player was told to fetch. */
export interface PulledItem {
    item: RundownItem;
    url: string;
    /** The cue to arm alongside it, resolved to something the player can fetch. */
    voice?: { url: string; atMs: number };
}

/**
 * How long a handed-over item may be unaccounted for before the rundown believes
 * the push was lost.
 *
 * Generous on purpose, because the two ways of being wrong are not symmetrical.
 * Too short and an item still downloading is offered again and airs twice, which is
 * audible and wrong. Too long and a genuinely lost push is recovered a few
 * seconds late — during which the item on air is still playing, so nothing is
 * heard at all. A Spotify track comes through the shim, which decrypts it from
 * the CDN, so seconds rather than milliseconds is the normal case.
 */
const RESOLVE_GRACE_MS = 15_000;

/** What is on air, as far as the player has told us. */
export interface NowPlaying {
    item: RundownItem;
    /** Epoch millis when it went on air, as observed here. */
    startedAt: number;
    /**
     * Milliseconds left, when the decoder last said. Taken at face value and
     * only ever displayed: nothing schedules against it, which is what makes a
     * jumpy reading cosmetic here rather than something that could take a track
     * off air early.
     */
    remainingMs?: number;
}

/** The fields of a rundown item that come from a plugin's catalog. */
export type RundownTrack = Omit<RundownItem, 'id'>;

/** The airing item's bookkeeping: which one, and when the playhead was last measured. */
interface AiringItem {
    id: string;
    startedAt: number;
    remainingMs?: number;
    observedAt: number;
}

@Injectable()
export class Rundown {
    /**
     * The running order, once the director has one to attach.
     *
     * Absent before boot has finished and after a shutdown, and everything here
     * answers emptily for that rather than throwing: the pusher's loop runs on a
     * timer that starts before the director's `ready`.
     */
    private order?: LiveOrder;
    /**
     * Each item in the form the player can actually be handed.
     *
     * The one thing the order genuinely cannot hold. A record carries everything it
     * needs, but a segment is a REFERENCE — `deadair.segments` owns its label, its
     * state and its audio — and copying any of that into a document rewritten on a
     * throttle would air a segment under whatever it used to be called. So the
     * director resolves the next few items into this map, and a copy that lives for
     * seconds is allowed to be a copy.
     *
     * An item with no entry here is one this process cannot speak for, which is
     * exactly the question {@link observeOnAir} has to answer.
     */
    private prepared = new Map<string, RundownItem>();
    /**
     * When each handed-over item was given to the player.
     *
     * A pushed request is INVISIBLE for a while: Liquidsoap pops it off the queue to
     * resolve it — for an http uri, to download the whole track — and during that
     * window it is neither counted in `queued` nor reported as `onAir`. A reconcile
     * that read that gap as a lost push would hand the same item over twice, and the
     * listener would hear the track twice. See {@link RESOLVE_GRACE_MS}.
     */
    private servedAt = new Map<string, number>();
    /** Confirmed on air by the player, with the playhead as last measured. */
    private airing?: AiringItem;
    /** The last unexplainable id the player named, so it is reported once rather than every tick. */
    private unknownOnAir?: string;
    /**
     * Bumped whenever the running order is retracted or dropped, so work already in
     * flight against the old one can tell.
     *
     * Only {@link next} spans an await today, but every future path that resolves,
     * renders or fetches before touching this state needs the same token: the
     * event loop is free during any of them, and `retract` and `reset` both run
     * synchronously from a request handler.
     */
    private readonly epoch = new Epoch();

    private readonly changeListeners = new Set<() => void>();
    private readonly resetListeners = new Set<(standingDown: boolean) => void>();
    private readonly airedListeners = new Set<(item: RundownItem) => void>();

    constructor(
        private readonly resolver: TrackResolver,
        private readonly logger: Logger,
    ) {}

    /**
     * Bind the running order this transport is driving.
     *
     * The director attaches it, because the director owns it. A setter rather than a
     * constructor argument because the two have different lifetimes: this is
     * registered in PlayoutModule and the order is not read until the director's
     * `ready`, several modules later.
     */
    attach(order: LiveOrder): void {
        this.order = order;
    }

    /** Give up the running order entirely: what a shutdown does. */
    detach(): void {
        this.order = undefined;
        this.prepared.clear();
        this.servedAt.clear();
        this.airing = undefined;
    }

    /**
     * Take the playable form of some items, so they can be handed over.
     *
     * Additive and idempotent: preparing an item twice replaces its entry, which is
     * what a re-resolved segment or a newly attached cue wants. It changes NOTHING
     * about the order — that is the director's, and preparing is the transport
     * being told how to play what the director has already decided.
     */
    prepare(items: readonly RundownItem[]): void {
        if (items.length === 0) return;

        for (const item of items) this.prepared.set(item.id, item);
        this.emit();
    }

    /**
     * Whether this item already has a playable form here.
     *
     * What stops the director preparing the same items forever. Preparing is
     * idempotent by design — the same item can be re-resolved, and a cue can be
     * attached to a record already prepared — so nothing about the order changes when
     * it happens twice. But every prepare announces a change, and a change asks for
     * another pass, so a pass that offered the next few PLANNED items without asking
     * this would prepare the same three items on every one of them and never stop.
     */
    isPrepared(itemId: string): boolean {
        return this.prepared.has(itemId);
    }

    /**
     * Take back everything the player is holding, without ending the broadcast.
     *
     * What a change of programming does. Everything handed over and not heard goes
     * back to `planned` in the order, so whoever plans next can offer it again; what
     * is ON AIR keeps playing, because a new running order is not a reason to cut the
     * listener off mid-record.
     */
    retract(): void {
        this.epoch.bump();
        this.order?.reclaimAll();
        this.servedAt.clear();
        this.forgetPreparedExcept(this.airing?.id);
        // Not a stand-down: the station is still on air, playing the item it was
        // already playing, and only what comes after it has changed.
        this.announceReset(false);
        this.emit();
    }

    /**
     * Stop: give up the running order entirely, including whatever was on air.
     *
     * The airing item goes too, which is what makes this a stand-down rather than a
     * change of plan. deadair holds the mount only while it has a programme
     * ({@link hasProgramme}), so leaving it airing would have the station asserting
     * control of a track it has just abandoned, and the audio would outlive the
     * command by a whole item.
     *
     * What was airing is marked `played` rather than reclaimed: the listener heard
     * it, at least partly, and offering it again would replay a record they were in
     * the middle of.
     */
    reset(): void {
        this.epoch.bump();
        if (this.airing) this.order?.markPlayed(this.airing.id);
        this.order?.reclaimAll();
        this.servedAt.clear();
        this.prepared.clear();
        this.airing = undefined;
        this.unknownOnAir = undefined;
        this.announceReset(true);
        this.emit();
    }

    /**
     * Whether the station currently has anything it is responsible for airing.
     *
     * This is the question the dead-man switch is answered with: deadair holds
     * the mount while this is true and hands it back when it is not, so an app
     * that is merely RUNNING does not keep a station on air with nothing to play.
     * An empty running order after a restart is exactly that case.
     */
    hasProgramme(): boolean {
        return this.airing !== undefined || this.upcoming().length > 0;
    }

    /**
     * Everything committed but not yet on air, in the order it will air.
     *
     * What the player is already HOLDING comes first, because those items have been
     * handed over and, for an http uri, downloaded — leaving them out is how a
     * console ends up naming the track after next as "next". The order itself puts
     * them in the right place, which is one of the things the merge bought: they used
     * to live in two arrays that had to be concatenated in the right order by hand.
     *
     * Only prepared items. One the director has not resolved yet is a plan rather
     * than something the player could be given.
     */
    upcoming(): readonly RundownItem[] {
        return this.orderedByState(state => state === 'handed' || state === 'planned');
    }

    /**
     * How many prepared items are waiting HERE, which is a smaller number than
     * {@link upcoming} by whatever the player is holding.
     *
     * The pusher's own bookkeeping, not an answer for a console.
     */
    queuedCount(): number {
        return this.orderedByState(state => state === 'planned').length;
    }

    /**
     * How many items the player is believed to be holding: handed over and not
     * yet aired.
     *
     * What the pusher tops up against, and deliberately not the reading's own
     * `queued`. That number omits the request Liquidsoap is currently resolving,
     * so it dips for the length of a download — and a top-up driven by it hands
     * over an extra item every pass until the fetch completes. This is the same
     * number reconciled against the reading a moment earlier, so it counts what
     * is in flight too.
     */
    servedCount(): number {
        return this.handedIds().length;
    }

    /**
     * What is on air, with the playhead projected from the last reading. Projected
     * on read rather than on a timer, so it is never served stale and nothing
     * pulses through the listeners every couple of seconds.
     */
    nowPlaying(): NowPlaying | undefined {
        const item = this.airing === undefined ? undefined : this.prepared.get(this.airing.id);
        if (!this.airing || !item) return undefined;

        const { startedAt, remainingMs, observedAt } = this.airing;
        if (remainingMs === undefined) return { item, startedAt };
        return { item, startedAt, remainingMs: Math.max(0, remainingMs - (Date.now() - observedAt)) };
    }

    /**
     * Hand the next item over: resolve a URL for it and mark it handed. Returns
     * `undefined` when nothing is left, at which point the player drains and the
     * mount falls back to the local bed.
     *
     * Skips, rather than stalls on, an item it cannot resolve. A track whose
     * plugin is disabled or whose upstream is refusing is one track; silence is
     * the whole station.
     */
    async next(): Promise<PulledItem | undefined> {
        for (;;) {
            // Taken BEFORE the resolve, and checked after it. Resolving is the longest await in
            // the transport — a provider call for a track, a database read for a segment — and the
            // running order can be retracted or dropped entirely while it is in flight. Without
            // this, a Stop given mid-resolve is followed by the item being marked handed anyway,
            // the pusher giving it to the player, and the listener hearing one more record out of
            // a programme the operator has already ended.
            const token = this.epoch.current();
            const item = this.upcoming().find(candidate => this.stateOf(candidate.id) === 'planned');
            if (!item) break;

            // Marked BEFORE the resolve, so nothing offers the same item twice while this one is
            // in flight. A retraction takes it back to `planned` on its own, which is exactly the
            // behaviour wanted: the epoch check below then declines to hand it over.
            this.order?.markHanded(item.id);
            const url = await this.resolver.resolve(item);

            if (!this.epoch.isCurrent(token)) {
                // Deliberately nothing to undo: a retraction has already reclaimed this item, and
                // a stand-down means there is nothing to go back to.
                this.logger.info('rundown: the running order changed while an item was being resolved; dropping it', { item: item.id });
                return undefined;
            }

            if (!url) {
                this.logger.warn(`rundown: cannot resolve '${item.title}' (${item.pluginId}:${item.externalId}) — skipping it`);
                this.order?.markSkipped(item.id);
                continue;
            }

            // The cue goes through the same resolver as the item it rides on, so there is one
            // place that knows how to turn something into audio the player can fetch. A cue that
            // will not resolve costs the talk-over and nothing else: the record still airs, which
            // is the right way round — the DJ missing a break is a quiet failure, the record
            // missing is an audible one.
            const voice = item.voice === undefined ? undefined : await this.resolveVoice(item.voice);

            this.servedAt.set(item.id, Date.now());
            this.emit();
            return { item, url, ...(voice === undefined ? {} : { voice }) };
        }
        this.emit();
        return undefined;
    }

    /**
     * A cue's audio, as a URL, or `undefined` if it cannot be had.
     *
     * Asks the resolver chain with a synthetic item, because a cue names a segment
     * and the chain already knows how to answer for one. The alternative — the
     * pusher building the URL itself — would put a second opinion about where
     * segment audio lives next to the first.
     */
    private async resolveVoice(voice: { segmentId: string; atMs: number }): Promise<{ url: string; atMs: number } | undefined> {
        const url = await this.resolver
            .resolve({ id: `voice:${voice.segmentId}`, pluginId: RENDER_PLUGIN_ID, externalId: voice.segmentId, title: '', artists: [] })
            .catch(() => undefined);

        if (!url) {
            this.logger.warn('rundown: a talk-over segment could not be resolved; the record airs without it', { segment: voice.segmentId });
            return undefined;
        }
        return { url, atMs: voice.atMs };
    }

    /**
     * Offer a handed-over item again, because the push did not land.
     *
     * Nothing aired, so the next pass should offer the same thing rather than lose
     * it. The order puts it back where it belongs on its own, which is the other
     * thing the merge bought: this used to have to unshift it onto the head of a
     * second list and hope the two agreed.
     */
    unserve(id: string): boolean {
        if (this.stateOf(id) !== 'handed') return false;

        this.order?.reclaim([id]);
        this.servedAt.delete(id);
        this.emit();
        return true;
    }

    /**
     * The player says this item started. Anything handed over before it was
     * skipped — a failed decode, an operator skip — and the order marks those as it
     * moves.
     *
     * Returns false for an id the order does not hold, which is how a stale notify
     * from a previous session is ignored rather than invented into the running order.
     */
    markAired(id: string): boolean {
        if (this.airing?.id === id) return true;
        if (!this.order?.markAiring(id)) return false;

        this.setAiring(id);
        this.emit();
        return true;
    }

    /**
     * Take one reading of the player and make it the truth.
     *
     * The counterpart to {@link markAired}: the notify is a push, so it reacts on
     * the boundary itself, while this is a pull on the pusher's loop. That is
     * what makes the cases a notify cannot cover recoverable — a dropped notify,
     * an item ENDING with nothing behind it (which no boundary announces), a
     * Liquidsoap restart that silently forgot everything handed to it, and a
     * queue shallower than we think we filled.
     *
     * Believes nothing unless `ready` is present: that field only exists in the
     * radio.liq that reports the rest of the reading, so its absence means the
     * container is on an older script and there is nothing here to trust.
     */
    reconcile(reading: QueueStatus): void {
        if (reading.ready === undefined) return;

        // Whether the reading names an item this process can speak for. False is the
        // one thing the reading is certain about: whatever we still hold is NOT on air.
        const named = reading.onAir === undefined || this.observeOnAir(reading.onAir);

        if (!reading.ready || !named) {
            this.retireAiring();
        } else if (reading.remainingMs !== undefined && this.airing) {
            this.airing.remainingMs = reading.remainingMs;
            this.airing.observedAt = Date.now();
        }

        this.reconcileServed(reading.queued);
        this.forgetSpentPrepared();
    }

    /** Subscribe to running-order changes. Returns the unsubscribe. */
    onChange(listener: () => void): () => void {
        this.changeListeners.add(listener);
        return () => this.changeListeners.delete(listener);
    }

    /**
     * Subscribe to the order being retracted or dropped. Returns the unsubscribe.
     *
     * `standingDown` tells the two apart, and they are not the same command: a
     * retraction keeps the station on air and only takes back what has not been
     * heard yet, while a stand-down ends the broadcast. Only the second one is
     * allowed to cut a listener off mid-track.
     *
     * It no longer carries the items that went with it. The order is shared, so they
     * have already been put back by the time a listener runs — which is the whole
     * point of there being one list.
     */
    onReset(listener: (standingDown: boolean) => void): () => void {
        this.resetListeners.add(listener);
        return () => this.resetListeners.delete(listener);
    }

    /**
     * Subscribe to an item actually going ON AIR. Returns the unsubscribe.
     *
     * Fires exactly once per item, from the one place that can honestly say it
     * started: whichever of the notify or a reading got here first. Not on
     * {@link next}, which runs an item ahead of the listener, and not again for an
     * item already airing when a second confirmation arrives.
     *
     * This is the trigger for everything that has to be true of what was HEARD —
     * play history, now-playing metadata, a back-announce — and using the
     * hand-over instead is precisely how all three end up a track early.
     *
     * Listeners are called synchronously and must not throw or block: this runs on
     * the boundary, and the next item is being fetched behind it. A listener with
     * real work to do hands it off (a job, a bus publish) and returns.
     */
    onAired(listener: (item: RundownItem) => void): () => void {
        this.airedListeners.add(listener);
        return () => this.airedListeners.delete(listener);
    }

    /**
     * Reconcile what the player is holding against what we think we handed it.
     *
     * `queued` excludes the item on air, so it is exactly the handed count when
     * everything landed. Fewer means a push went missing (or Liquidsoap
     * restarted), and those items are offered again rather than left
     * believed-delivered — the alternative is a running order that quietly skips
     * them. The tail is what goes back, because the player consumes from the
     * front.
     *
     * EXCEPT while an item is still being resolved. Liquidsoap takes a pushed
     * request off the queue to fetch it, and until the first frame plays it is in
     * neither `queued` nor `onAir` — so a short reading is the NORMAL state for
     * the seconds it takes to download a track, not evidence of anything. Acting
     * on it hands the same item over a second time and the listener hears the
     * track twice. Only an item that has been unaccounted for longer than
     * {@link RESOLVE_GRACE_MS} is treated as lost.
     */
    private reconcileServed(queued: number): void {
        const handed = this.handedIds();
        if (queued >= handed.length) return;

        const settledBy = Date.now() - RESOLVE_GRACE_MS;
        const lost = handed.filter((id, index) => index >= queued && (this.servedAt.get(id) ?? 0) <= settledBy);

        // Everything short is still within its grace: the player is fetching, which
        // is the overwhelmingly common reason for a reading to be short at all.
        if (lost.length === 0) return;

        this.order?.reclaim(lost);
        for (const id of lost) this.servedAt.delete(id);
        this.logger.warn(`rundown: the player never took ${lost.length} of ${handed.length} handed over; offering them again`);
        this.emit();
    }

    /**
     * The player named the item it is playing. Almost always one we already
     * believe is on air, because the notify beat this here by a tick.
     *
     * An id the order does not hold belongs to a session before this process
     * started — a Liquidsoap that outlived a schema rebuild. There is nothing
     * truthful to say about it, so it is never invented into the running order; it is
     * reported once and the clock stands down.
     *
     * An id the order DOES hold but this process cannot play — one dropped by a
     * stand-down — is ours, and stands the clock down without a diagnostic: the
     * player does not stop on the same instant the command is given, so the next
     * reading can still name something we have just given up on.
     */
    private observeOnAir(id: string): boolean {
        if (this.airing?.id === id) return true;
        if (this.prepared.has(id) && this.markAired(id)) {
            this.unknownOnAir = undefined;
            return true;
        }
        // Ours, dropped a moment ago and not yet stopped. There is no fault to report.
        if (this.order?.has(id)) return false;

        if (this.unknownOnAir !== id) {
            this.unknownOnAir = id;
            this.logger.warn(`rundown: the player is airing item ${id}, which this station's running order does not hold — standing the clock down`);
        }
        return false;
    }

    private setAiring(id: string): void {
        this.airing = { id, startedAt: Date.now(), observedAt: Date.now() };
        this.unknownOnAir = undefined;
        this.servedAt.delete(id);

        const item = this.prepared.get(id);
        if (item) this.announceAired(item);
    }

    /**
     * Tell the listeners an item started.
     *
     * Each one is isolated, unlike the change listeners: this is the only
     * notification that cannot be recovered by the next reconcile tick, so one
     * subscriber throwing must not cost the others the event. The state has already
     * been committed by the time this runs.
     */
    private announceAired(item: RundownItem): void {
        for (const listener of this.airedListeners) {
            try {
                listener(item);
            } catch (error) {
                this.logger.warn(`rundown: an aired listener threw (${error instanceof Error ? error.message : String(error)})`);
            }
        }
    }

    /** Take the airing item off air: the player says it is not producing it. */
    private retireAiring(): void {
        if (!this.airing) return;

        this.order?.markPlayed(this.airing.id);
        this.airing = undefined;
        this.emit();
    }

    /** The prepared items in the order's own sequence, narrowed by state. */
    private orderedByState(wanted: (state: string) => boolean): RundownItem[] {
        if (!this.order) return [];

        return this.order
            .all()
            .filter(item => wanted(item.state))
            .flatMap(item => {
                const prepared = this.prepared.get(item.id);
                return prepared === undefined ? [] : [prepared];
            });
    }

    /** The ids the player is believed to be holding, in hand-over order. */
    private handedIds(): string[] {
        return (this.order?.all() ?? []).filter(item => item.state === 'handed').map(item => item.id);
    }

    private stateOf(id: string): string | undefined {
        return this.order?.all().find(item => item.id === id)?.state;
    }

    /** Forget the playable form of everything the station is done with. */
    private forgetSpentPrepared(): void {
        for (const item of this.order?.all() ?? []) {
            if (item.state === 'played' || item.state === 'skipped') this.prepared.delete(item.id);
        }
    }

    private forgetPreparedExcept(keep: string | undefined): void {
        for (const id of [...this.prepared.keys()]) {
            if (id !== keep) this.prepared.delete(id);
        }
    }

    private emit(): void {
        for (const listener of this.changeListeners) listener();
    }

    private announceReset(standingDown: boolean): void {
        for (const listener of this.resetListeners) listener(standingDown);
    }
}
