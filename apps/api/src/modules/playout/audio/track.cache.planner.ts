import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { isTrackItem, type StationLineup } from '#modules/director/station.lineup.js';
import { TrackAudioRepository } from './track.audio.repository.js';
import { CACHE_AHEAD, TrackAudioService } from './track.audio.service.js';

/**
 * Records fetched per pass.
 *
 * TWO, which with `TrackAudioService`'s in-flight de-duplication means at most two downloads at a
 * time: the pass runs on every rundown change, so a small cap plus "nothing already in flight" is
 * what turns a window of six into a trickle rather than a burst.
 *
 * It was one, which was the right number while the window matched the commit lead and warming was an
 * optimisation. It is two now because the window LEADS the commit lead and the director will not
 * commit a record whose audio is missing: at one per pass a cold running order fills more slowly
 * than it drains, and the thing that runs out is not the cache but the station's willingness to
 * commit anything. Still small, because every fetch is a whole record off a rate-limited credential.
 */
const FETCH_PER_PASS = 2;

/** What one pass of the ripener did, and what it found that no fetch is going to fix. */
export interface RipenResult {
    /** How many records were asked for. */
    asked: number;
    /**
     * Running-order item ids whose audio is not coming: every copy benched, or a backoff that
     * outlasts the item's own slot.
     *
     * The DIRECTOR acts on these, because nothing else may write the running order. They are ITEM
     * ids rather than bindings for the same reason: what the director does with one is take that
     * line out, and the same record may legitimately sit at two positions.
     *
     * Only ever records the CATALOG holds. An item with no `trackId` is never named here, however
     * little is known about it — see the guard in {@link TrackCachePlanner.ripen}. "Nothing will
     * serve this" and "nobody has catalogued this yet" are opposite facts, and the second is the
     * ordinary state of a fresh station.
     */
    unfetchable: string[];
    /**
     * Records in the window whose bytes are actively on their way: in flight already, or asked for
     * on this pass.
     *
     * What it exists for is telling two silences apart that look identical from anywhere else. A
     * station with a full running order and nothing committed is either downloading its first
     * records — which is working, and wants no operator at all — or waiting on an upstream that has
     * stopped answering. `waitingOnAudio` alone had to call both of them the same thing.
     *
     * A COUNT rather than a boolean because it costs nothing to be specific and a console can say
     * "fetching 2 records" instead of "please wait". Note it says nothing about how far along any of
     * them is: `TrackAudioService` de-duplicates by source id and holds no progress, and a byte
     * count would be a second thing to keep in step with a download nobody is watching.
     */
    warming: number;
}

const NOTHING: RipenResult = { asked: 0, unfetchable: [], warming: 0 };

/**
 * How long the head of the warm window is assumed to be from air, at the least.
 *
 * The window opens at the first item the director has NOT committed, so everything the player is
 * holding is in front of it — and this class can see neither what is airing nor how much of it is
 * left. One record's worth is the floor, which is the smallest true statement available: the head of
 * the window cannot air before the record in front of it finishes.
 *
 * It only ever matters for judging a BACKOFF, where being wrong low is the costly direction: a record
 * dropped from the order over a five-minute backoff it would comfortably have beaten is programming
 * thrown away for a blip. Being wrong high costs one more pass before the same record is dropped.
 */
const COMMITTED_LEAD_MS = 4 * 60 * 1000;

/**
 * How far BEHIND the window the eviction sweep is told to keep its hands off, in items.
 *
 * The warm window opens at the first uncommitted item, so everything the player is holding sits in
 * front of it — including the record airing right now, whose bytes Liquidsoap may still be pulling
 * and which a `MAX_HAND_OVERS` retry may ask for again. Evicting any of that would produce exactly
 * the silence the commit gate exists to prevent.
 *
 * Small, because this is the past: a handful of items covers the committed lead and the retry window
 * with room to spare, and protecting more would be protecting records the station has finished with.
 */
const PROTECT_BEHIND = 4;

/**
 * Getting the next few records in hand before their slots arrive.
 *
 * The same shape as `BreakPlanner.ripen`, on the same commit pass, and for the same reason: the
 * expensive half of an item should happen near its slot rather than at it. What it buys here is that a
 * record's FIRST play is served from the station's own copy — without it, the first play of every
 * record is a live provider fetch inside the request Liquidsoap is waiting on, which works (that is
 * `TrackAudioService.ensure`'s job) but spends a download on the critical path.
 *
 * ## What it does not do
 *
 * It does not decide whether the bytes are kept. `playout.trackCache` does, inside `ensure`, and this
 * pass runs either way — warming is worth doing for a station keeping nothing, because the hold is what
 * the request a minute later is served from. That split is the whole point of the reshape: this is
 * about WHEN a fetch happens, never about whether a record can be played.
 *
 * ## Sending is free, so this does not have to remember
 *
 * `TrackAudioService` de-duplicates by source id, covering the lookup as well as the download, so a
 * second send for a record already being fetched waits on the first rather than starting another. That
 * is what lets this re-offer whatever is still missing on every pass instead of keeping a list of what
 * it already asked for — a list which, being in memory, would be wrong after every restart.
 *
 * It does mean duplicate SENDS happen, and measurement on the running station confirms it: a pass
 * inside the second or two between a send and the broker picking the job up sees a record with no
 * checksum and nothing in flight, and sends again. Four jobs for two records, in the observed case.
 * That is deliberately not worth preventing — the second job reaches `ensure`, finds the record on disk
 * or already coming, and costs one indexed read. Preventing it would take either a short-lived memory
 * of what was sent (wrong after a restart, in the direction that loses fetches) or a read of the
 * broker's queue, which is a round trip to save a round trip.
 *
 * ## An off-air station fetches nothing
 *
 * Because the pass that calls this only runs while the director is driving. A station nobody is
 * listening to should not be spending a provider's quota on records it is not about to play.
 */
@Injectable()
export class TrackCachePlanner {
    constructor(
        private readonly audio: TrackAudioRepository,
        private readonly service: TrackAudioService,
        private readonly jobs: PgBossJobBroker,
        private readonly logger: Logger,
    ) {}

    /**
     * Ask for the audio of the records whose slots are coming up, and say which of them will not be
     * arriving in time.
     *
     * Both halves come out of ONE read of the window, which is why they are one method rather than
     * two: the same `track_audio` rows that decide what is worth fetching are what say a record is
     * hopeless. Splitting them would be a second query per pass to answer a question already asked.
     *
     * The caller applies the second half — only the director may write the running order.
     */
    async ripen(lineup: StationLineup): Promise<RipenResult> {
        const items = lineup.all();
        const from = Math.max(0, lineup.committedThrough());
        const window = items.slice(from, from + CACHE_AHEAD);

        // Records only. A segment's audio is the render module's business and is either `ready` by the
        // time the director looks at it or skipped.
        const records = window.filter(isTrackItem);

        // The span the sweep may not touch: the warm window plus what the player is already holding.
        // Wider than the window this pass fetches for, which is why it is read separately and why the
        // decisions below still walk `records` — a record already airing is nothing to fetch and
        // everything to protect.
        const guarded = items.slice(Math.max(0, from - PROTECT_BEHIND), from + CACHE_AHEAD).filter(isTrackItem);
        const bindings = guarded.map(item => ({ pluginId: item.track.pluginId, externalId: item.track.externalId }));
        if (bindings.length === 0) {
            // Nothing in the window, so nothing is protected either. Said explicitly rather than left
            // to expire, because an order with no records ahead of it is a real state and a stale set
            // would go on speaking for it.
            this.service.protect([]);
            return NOTHING;
        }

        // One query for the whole guarded span. Anything the catalog has written off is absent from
        // the answer rather than reported as missing, which is the same thing as far as this is
        // concerned: not worth a fetch. The order of the answer is the query's, so the walk below is
        // over the window's order rather than the row order — nearest slot first.
        const states = await this.audio.findForBindings(bindings);
        const byBinding = new Map(states.map(state => [`${state.pluginId} ${state.externalId}`, state]));

        // Published before anything else can fail, because the cost of not publishing is a sweep that
        // evicts a record about to air, and the cost of publishing too much is that one pass keeps a
        // few more records than it needed to.
        this.service.protect(states.map(state => state.sourceId));

        const wanted: string[] = [];
        const unfetchable: string[] = [];
        /** Records the window found already being fetched, which this pass adds to rather than starts. */
        let inFlight = 0;
        // How much airtime stands between now and the item being judged. It is what a backoff is
        // measured against: a record that will not be tried again until after its own slot has come
        // and gone is not going to be here in time, whatever happens after that.
        //
        // It starts at {@link COMMITTED_LEAD_MS} rather than zero, because the head of this window is
        // NOT the record playing now — everything the director has already committed is in front of
        // it, and this class cannot see how much of that is left to play.
        let airtimeAhead = COMMITTED_LEAD_MS;

        for (const item of records) {
            const state = byBinding.get(`${item.track.pluginId} ${item.track.externalId}`);
            const slotAt = Date.now() + airtimeAhead;
            // Accumulated BEFORE the guard below, because an item this pass has no opinion about
            // still occupies its slot: skipping the addition would shorten the projected airtime for
            // everything behind it and judge their backoffs against a moment that never arrives.
            airtimeAhead += item.track.durationMs ?? 0;

            // Only a record the CATALOG holds can be judged here, which is the same rule
            // `DirectorService.toPlayerItems` applies one window later and for the same reason: a
            // pick straight from a provider playlist has no `trackId`, so it has no binding row to
            // be missing and nothing here can say anything true about it. It is not a fetch
            // candidate — there is no `track_sources.id` to fetch — and it is emphatically not
            // unfetchable. It answers for itself at hand-over.
            //
            // Without this the two states below collapse into one, and the collapse is not
            // theoretical: on a fresh install, or for any imported playlist ahead of the first
            // catalog sync, EVERY item is uncatalogued. Read as "every copy is benched" that marked
            // 125 records of a 519-item order permanently unavailable in eight minutes, none of
            // which was unobtainable — see `docs/decisions/bytes-before-air.md`.
            if (item.track.trackId === undefined) continue;

            // Absent from the answer for a record the catalog DOES hold means every copy has been
            // written off — `findForBindings` joins from `track_sources` and excludes `missing_at` —
            // so nothing will serve it. Known HERE rather than at the commit window, which is the
            // whole point: there is still an hour of running order in front of it for a refill to
            // fill the gap.
            if (state === undefined) {
                unfetchable.push(item.id);
                continue;
            }
            // Already on disk. Nothing to fetch and nothing to wait for.
            if (state.checksum !== undefined) continue;

            // On its way: an earlier pass asked, or a request that wanted the bytes got there first.
            // Counted rather than merely skipped, because a station committing nothing while this is
            // non-zero is warming up, and one committing nothing while it is zero is stuck.
            if (this.service.isFetching(state.sourceId)) {
                inFlight += 1;
                continue;
            }

            // Backing off after a refusal. This is the ONE place the backoff is read, because this is
            // the only speculative fetch: a request for these bytes ignores it, since something is
            // waiting on them and a blip should not cost the item.
            if (state.nextAttemptAt !== undefined && state.nextAttemptAt.toMillis() > Date.now()) {
                // A backoff that outlasts the record's own slot is not a wait, it is a miss. The ladder
                // doubles to a day, so the fourth refusal of a record two boundaries away puts its next
                // attempt hours past the moment anybody needed it.
                if (state.nextAttemptAt.toMillis() > slotAt) unfetchable.push(item.id);
                continue;
            }

            if (wanted.length < FETCH_PER_PASS) wanted.push(state.sourceId);
        }

        for (const sourceId of wanted) await this.jobs.send('playout.cache_track', { sourceId });

        if (wanted.length > 0) {
            this.logger.info('playout: fetching a record before its slot', { count: wanted.length, window: bindings.length });
        }

        // The jobs just sent count as warming alongside the ones already running: the send is what
        // makes the bytes start coming, and a pass that asked for two records has done something
        // about the silence even though nothing has arrived yet.
        return { asked: wanted.length, unfetchable, warming: inFlight + wanted.length };
    }
}
