import { Container, Injectable } from 'injectkit';
import { ANALYSIS_SCHEMA_VERSION } from '@deadair/plugin-sdk';
import { Logger } from '@maroonedsoftware/logger';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { AnalysisRepository } from '#modules/analysis/analysis.repository.js';
import { AIR_MODE_KEY, parseAirMode, type AirMode } from '#modules/playout/air.mode.js';
import { AudienceWatch } from '#modules/playout/audience.watch.js';
import { TrackCachePlanner } from '#modules/playout/audio/track.cache.planner.js';
import { CACHE_AHEAD, TrackAudioService, bindingKey } from '#modules/playout/audio/track.audio.service.js';
import { Epoch } from '#modules/shared/epoch.js';
import { Heartbeat, HEARTBEATS } from '#modules/shared/heartbeat.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { Rundown, type RundownItem, type RundownTrack } from '#modules/playout/rundown.js';
import { PersonaRepository } from '#modules/personas/persona.repository.js';
import type { Persona } from '#modules/personas/persona.js';
import { ProductionRepository } from '#modules/productions/production.repository.js';
import { ProductionScheduler } from '#modules/productions/production.scheduler.js';
import { SegmentRepository, type Segment } from '#modules/render/segment.repository.js';
import { WARMUP_KIND } from './warmup.writer.js';
import { isRenderItem, segmentRundownTrack } from '#modules/render/segment.source.js';
import { inScope } from '#modules/shared/scoped.work.js';
import { ScrobbleService } from '#modules/scrobble/scrobble.service.js';
import type { ScrobblePlay } from '@deadair/plugin-sdk';
import { brokenClaim } from './break.claims.js';
import { BreakPlanner, expiryFor, type AirClock } from './break.planner.js';
import { isRenderedFirst, type BreakRequest, type BreakRequestResult, type StoredBreakRequest } from './break.request.js';
import { BreakRequestRepository } from './break.request.repository.js';
import { CandidatesRepository } from './candidates.repository.js';
import { DirectorMailbox, type DirectorCommand, type DirectorCommandResult, type OrderEdit, type ResumeResult } from './director.mailbox.js';
import { PlayHistoryRepository } from './play.history.repository.js';
import { resolveRules, stationRules, type ResolvedRules } from './rotation.rules.js';
import { MAIN_SLOT, StationAirRepository, type StationAir } from './station.air.repository.js';
import {
    StationLineup,
    isTrackItem,
    type EditResult,
    type ShuffleResult,
    type StationLineupBinding,
    type StationLineupItem,
    type StationLineupSnapshot,
} from './station.lineup.js';
import { StationLineupRepository } from './station.lineup.repository.js';
import { awaitsMeasurement, measurementOf } from './track.measurement.js';
import { errorText } from '#modules/shared/error.text.js';

/**
 * How many items to keep in the running order beyond what is airing.
 *
 * ONE, which is as small as this can be: the player needs the next item resolved before the current
 * one ends or the boundary is a gap, and nothing beyond that item has to be decided yet.
 *
 * It was three, and dropping it is what `docs/decisions/bytes-before-air.md` calls collapsing the
 * commitment horizon. It became affordable because a committed record's audio is now already on this
 * machine, so Liquidsoap's resolve is a loopback read of a local file rather than a provider
 * download — the lead used to be cover for a download that might take seconds, and there is no
 * download left to cover.
 *
 * What it buys is everything an operator edit could have changed. An item handed to the player is
 * one they can no longer reorder or remove, so a lead of three put the next quarter of an hour out
 * of reach; at one, a skip, a reorder and a fresh running order all take effect on the next record
 * rather than three later.
 *
 * **What it costs is skip latency, and that is a real regression rather than a rounding error.**
 * `PLAYOUT_LEAD` is capped by this — the pusher can only hand over what has been prepared — and
 * Liquidsoap only resolves as many requests ahead as it has been given. Measured on this station and
 * recorded in `radio.liq`: a skip onto a resolved item lands in about 200ms, and one onto an
 * unresolved queue is over 1.2s late or produces no boundary at all. At a lead of one there is
 * exactly one resolved item, so the FIRST skip still lands and a second one taken before the
 * replacement resolves does not. That trade was made deliberately; if clicking through several
 * tracks matters more than edit latency, this and `PLAYOUT_LEAD` go back up together.
 */
export const COMMIT_LEAD = 1;

/**
 * How long the station may commit nothing for want of audio before it says so.
 *
 * Long enough that the ordinary case is silent: a record still downloading is seconds to most of a
 * minute on a big file over a rate-limited credential, and a feed row per download would be noise.
 * Short enough to arrive before the consequence does — the player is holding at most `COMMIT_LEAD`
 * items, which is roughly ten minutes of music, so a minute of not committing is early enough to be
 * a warning rather than a post-mortem.
 */
export const WAITING_ON_AUDIO_MS = 60_000;

/**
 * How often a station that is waiting on bytes asks itself again.
 *
 * ## Why there has to be one at all
 *
 * A commit pass runs when the running order CHANGES, and nothing else. The single subscription in
 * {@link start} is the whole of it, and off air the change never comes: `PlayoutPusher`'s
 * `WARM_LEAD` is 0, so its reconcile never reaches `Rundown.next()` and the rundown never emits.
 *
 * On a warm station that is exactly right — the boundary is the change, and there is one every few
 * minutes. On a COLD one it deadlocks, because the pass that would ask for the bytes is the pass
 * that only runs once the bytes arrive. A fresh station sent its two `playout.cache_track` jobs and
 * then sat still: on 2026-08-20 the only thing that moved it for eight minutes was an operator
 * clicking Start over and over.
 *
 * A few seconds, and the yardstick is a DOWNLOAD rather than a boundary — the coarser cousin of
 * `RECONCILE_TICK_MS`, which has to be quick because it renews a lease with a six-second life. This
 * only has to notice that a record arrived, so anything much under a download's length is asking a
 * question whose answer cannot have changed.
 *
 * It is deliberately not a job. pg-boss cron is minute-granularity, which would put up to a minute
 * of dead air in front of the first listener; a self-rescheduling job would write a durable queue
 * row every few seconds forever to carry a decision that lives entirely in memory.
 */
export const WARM_TICK_MS = 5_000;

/**
 * The dedupe key every warm-up request is taken under. One station, one holding message at a time.
 *
 * `WELCOME_KEY`'s shape and its reason: the request table is what makes the cooldown survive a
 * restart, which is exactly when it matters, since a restart is also when every listener looks like
 * a fresh arrival and every record looks cold at once.
 */
const WARMUP_KEY = 'warmup';

/**
 * How long the station will not ask for another holding message.
 *
 * Long enough to cover writing and speaking one — the commit pass runs every few seconds, and
 * without this a station would queue a dozen while the first was still in the renderer. Short enough
 * that a wait outlasting one holding message gets another rather than falling silent, since the
 * whole point is to keep saying something for as long as the wait is a normal one.
 *
 * That upper bound is not this number's job: {@link WAITING_ON_AUDIO_MS} is, and it is what stops a
 * station whose provider has died reassuring an empty room all night.
 */
const WARMUP_COOLDOWN_MS = 20_000;

/**
 * Lineup states that mean an item is behind us.
 *
 * The complement of "still to come or happening now", written this way round because the three
 * forward states are the closed set and the past ones keep growing: `removed` and `unavailable` both
 * arrived after `skipped`, and a check written as a list of past states would have silently stopped
 * covering them.
 */
const isPast = (state: string): boolean => state !== 'planned' && state !== 'handed' && state !== 'airing';

/**
 * How many segments the gather may pull in beyond the records it is filling the window with.
 *
 * A segment is not necessarily an ITEM. One that is not `ready` is skipped, and a talk-over is heard
 * over the record behind it rather than between two, so both leave the window exactly as empty as
 * they found it. Counting them against `COMMIT_LEAD` therefore under-fills it — invisible at a lead
 * of three, where taking three candidates almost always yielded two or three items, and constant at
 * a lead of one, where a single break at the head meant a pass that committed nothing at all and no
 * change to wake the next one.
 *
 * Four, which is more consecutive segments than `BreakPlanner` will ever place: it plants one break
 * per slot and never two in a row. It is slack rather than a rule, so being wrong costs one pass.
 */
const SEGMENT_SLACK = 4;

/**
 * Commit the tail below this and a refill is sent.
 *
 * Comfortably more than {@link COMMIT_LEAD}, so the job has a dozen tracks of
 * airtime to finish in rather than racing the boundary. A station that waited
 * until it was empty would be asking a rate-limited walk to produce audio in the
 * next four minutes.
 */
const EXTEND_BELOW = 8;

/**
 * How long one refill send suppresses the next.
 *
 * The guard it bounds exists so a burst of rundown events cannot queue a dozen
 * identical jobs for one shortfall, and a time box serves that completely. What
 * it must not do is outlive the shortfall, which is what a plain latch did: a
 * refill that honestly resolved to NO records posted an empty append, which
 * returns before the commit pass that would have cleared the flag, so every
 * later boundary returned early and the order drained to nothing. The same
 * ending arrived four other ways — the job throwing with its retries spent, and
 * its three early returns that post nothing at all — and all five are one bug,
 * which is that the only evidence accepted for "the last one finished" was the
 * order growing. A refill can finish without growing it.
 *
 * Generous against how long a refill takes rather than tuned: the model half is
 * minutes on a slow host, and asking twice costs one wasted job where asking
 * never costs the station its running order.
 */
export const EXTEND_GUARD_MS = 300_000;

/** How long a reading of `station_air` is trusted before it is re-read. */
const AIR_TTL_MS = 5_000;

/**
 * How long the record may lag the running order.
 *
 * A **throttle, not a debounce**, and the difference is the whole reason this is a
 * number rather than a delay: a debounce reset by each new transition can starve
 * indefinitely under continuous activity, which is exactly when a stale record is
 * least affordable. Worst-case staleness here is one interval, whatever the rate.
 *
 * It applies only to what NOBODY IS WAITING FOR: an item handed over, one going on
 * air, one played. Losing an interval of those means replaying, which is the side
 * of the trade this codebase already chose. An acknowledged edit is written through
 * before its caller is answered, because the response says it happened.
 */
const PERSIST_THROTTLE_MS = 2_000;

/**
 * The music director: the actor that keeps the station's running order full,
 * remembers what aired, and decides what happens when the order ends.
 *
 * It REACTS rather than schedules. The rundown announces a change (an item
 * handed over, an item confirmed on air) and this commits whatever that leaves
 * room for, which means the station is driven by what the player has actually
 * done rather than by a clock guessing at it.
 *
 * **It owns the running order outright.** One {@link StationLineup} per station,
 * held here, edited here, and written down from here. Nothing else writes it and
 * there is no second copy for a request to edit — which is the whole of stage 2 of
 * `docs/decisions/on-air-ownership.md`, and the reason the revision, the cursor and
 * compaction are all gone rather than fixed.
 *
 * **Everything reaches it as a command on one queue**, handled one at a time and
 * in order: see {@link DirectorMailbox}. An operator's change, a finished refill
 * and the player's own events all arrive the same way, which is what stops two of
 * them landing in the middle of each other's decisions.
 *
 * The queue is not the whole answer, and the gap is worth knowing before adding
 * to it. Serializing decisions stops them interleaving; it does not un-decide one
 * already made. A pass that has gathered its material and is waiting on a database
 * read has already decided, and a command queued behind it arrives too late to
 * stop it. So anything that must CANCEL rather than merely follow — a stand-down,
 * a new running order — bumps {@link epoch} synchronously at the moment it happens
 * and posts only the durable half. `beginStandDown` and
 * `DirectorConsoleService.announceAirChange` are both written around that.
 *
 * One per process, for the reason `Rundown` and `PlayoutPusher` are: it holds
 * subscriptions and the running order, and a per-request copy would hand every
 * caller a different, empty view of what is on air. Its database work therefore
 * runs in a scope it opens per unit of work, the pattern `PlayoutModule.ready`
 * uses.
 *
 * **It only ever commits while `active`.** That flag is the station's own
 * switch, it is stored, and it is what makes a stand-down stick: an app that
 * merely stopped pushing would put the station back on air on its next tick, and
 * an app restarted after a stand-down would come back broadcasting something
 * nobody asked for.
 */
@Injectable()
export class DirectorService {
    /** The station's running order. Absent before it has ever been given one. */
    private lineup?: StationLineup;
    /** The last reading of `station_air`, and when it was taken. */
    private air?: StationAir;
    private airReadAt = 0;
    private active = false;
    /**
     * What puts the station on air, as the setting currently stands.
     *
     * Reported here and acted on by {@link AudienceWatch}, which reads it the same
     * way. Neither of them holds a copy: `deadair.settings` is a layer of the app's
     * config, so this is the row itself rather than a reading of it taken on some
     * throttle, and the console cannot show a mode the gate is not using.
     */
    private get airMode(): AirMode {
        return parseAirMode(this.config.get(AIR_MODE_KEY, ''));
    }
    /**
     * When a refill was last asked for, or `undefined` for not waiting on one.
     *
     * A timestamp rather than a flag, because it has to expire: see {@link EXTEND_GUARD_MS}.
     * Cleared early once the order has actually grown, which is the good outcome.
     */
    private extendSentAt?: number;
    /**
     * A stand-down whose write has not landed yet.
     *
     * `Rundown.reset` calls its listeners synchronously, so between the operator's
     * Stop and the row saying `active: false` there is a window in which a wake
     * would read the OLD row and put the station straight back on air. This is the
     * intent, held in memory, until the storage agrees with it.
     */
    private standingDown = false;
    /**
     * Whether the stand-down now in flight is one that took the station OFF air, as opposed to one
     * asked of a station that was already off.
     *
     * Only the activity feed reads it, and only so that a stop pressed twice is one line. It has to
     * be a field rather than a local because the two halves of a stand-down are deliberately split
     * across the mailbox: the transition is visible in {@link beginStandDown} and the event is
     * written after the durable half lands in {@link standDown}.
     */
    private standDownFromActive = false;
    /**
     * Bumped wherever the plan this pass was computed against stops being the plan:
     * a stand-down, a new running order, an edit.
     *
     * It replaces a pair of flags read at the top of the pass, and covers what they
     * could not. `standingDown` answers "was it stopped"; this answers "is anything
     * different", which stays the right question as new ways to change what is on
     * air are added — and there are several coming.
     */
    private readonly epoch = new Epoch();
    private readonly mailbox = new DirectorMailbox(command => this.handle(command));
    /**
     * A talk-over whose record has not been committed yet.
     *
     * A commit batch is three items, so a talk-over planted before the last record of a batch has
     * nothing in that batch to ride on. Rather than drop it — which would lose a third of them —
     * it waits here for the first record of the next batch.
     *
     * Cleared wherever the plan changes, because a cue is about a particular record in a particular
     * running order, and one held across a stand-down or a new order would attach itself to the
     * first record of something else entirely.
     */
    private pendingVoice?: { itemId: string; segmentId: string; atMs: number; loudnessLufs?: number };
    private readonly unsubscribes: (() => void)[] = [];
    /**
     * Since when the commit window has held candidates and committed none of them, because none of
     * their audio is here yet. Absent whenever the last pass committed something.
     */
    private waitingOnAudioSince?: number;
    /** Whether the current wait has already been reported, so the feed carries one row and not one a second. */
    private waitingOnAudioReported = false;
    /** What the last ripen found on its way. See {@link warmingRecords}. */
    private warming = 0;
    /** A write the throttle owes. Set while a timer is pending; see {@link persistSoon}. */
    private persistTimer?: NodeJS.Timeout;
    /** The loop that asks again while the station is waiting on bytes. See {@link WARM_TICK_MS}. */
    private warmTimer?: NodeJS.Timeout;

    constructor(
        private readonly rundown: Rundown,
        private readonly audience: AudienceWatch,
        // The ROOT container, without anything having to hand it over: this class is a
        // singleton, and InjectKit resolves a singleton's dependencies from the root
        // rather than from whichever scope happened to build it. That matters here
        // because two of this class's dependents are resolved per scope
        // (`ExtendLineupJob` from the job runner's, `DirectorConsoleService` from a
        // request's), so before that rule a race decided whether every scope opened
        // below was the child of a container that had already been disposed. It logged
        // `Transaction is already committed` on roughly a third of boots.
        private readonly container: Container,
        // The singleton broker, which is what JobsModule documents for a non-request caller: it
        // resolves the root connection provider, and therefore pg-boss's own pool.
        private readonly jobs: PgBossJobBroker,
        // The station going on and off air, for the console's activity feed. A singleton like this
        // one, registered by a module below this one in `modules.ts`, which is safe because every
        // module's setup runs before any module's ready.
        private readonly activity: ActivityRecorder,
        // Which broadcast is on, published for everything that writes a row while it runs. The
        // director is the only writer of it, because it is the only thing that starts and ends a
        // broadcast; `render`, `catalog` and `activity` read it without knowing this class exists.
        private readonly identity: StationIdentity,
        // Beside `Epoch` and `StationIdentity` for the same reason those are here: a `shared/`
        // singleton the transport also reads, so the edge runs to neither module.
        private readonly heartbeat: Heartbeat,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /** Begin driving. Idempotent. */
    async start(): Promise<void> {
        if (this.unsubscribes.length > 0) return;

        this.unsubscribes.push(this.rundown.onChange(() => this.wake()));
        // NOT a command. This runs on the boundary, records what a listener actually heard, and
        // hands its own work off to a job; queueing it behind a commit pass would delay play
        // history for no benefit and put a write nobody is waiting on in front of the decisions
        // that keep the station on air.
        this.unsubscribes.push(this.rundown.onAired((item, passedOver) => this.remember(item, passedOver)));
        // A stand-down is the station being stopped, from wherever: the transport's
        // own Stop, or this class reaching the end of an order that says to stop. The
        // director has to hear it, or the next change event refills the running order
        // and the station is back on air a second after the operator stopped it.
        this.unsubscribes.push(
            this.rundown.onReset(standingDown => {
                // Nothing to put back here any more. The rundown shares the running order, so by
                // the time this runs the items it retracted are already `planned` again — which is
                // the whole point of there being one list rather than two that had to be walked
                // against each other.
                if (!standingDown) return;

                // Cancel first, in this stack frame, then queue the write. See `beginStandDown`:
                // a command cannot cancel a pass that is already gathering, because it runs after
                // it.
                this.beginStandDown();
                this.send({ kind: 'standDown' });
            }),
        );

        // The one thing that runs on a clock rather than on an event, and only because the event
        // cannot arrive: see {@link WARM_TICK_MS}. Registered with the heartbeat before its first
        // tick, per that class's own note that a loop should be measurable from its first
        // millisecond rather than from whenever it first completes.
        this.heartbeat.register(HEARTBEATS.directorWarm);
        this.warmTimer = setInterval(() => this.warmTick(), WARM_TICK_MS);
        this.warmTimer.unref?.();

        // Last, and the listeners above are armed first on purpose: this restore
        // ends in a commit pass that can reach the end of the order and stand the
        // station down, which is a `Rundown.reset` this class has to hear.
        //
        // POSTED rather than called, and that is not tidiness. A restore ends in a commit pass,
        // that pass appends to the rundown, and the append announces a change that posts a wake —
        // so a restore run OUTSIDE the queue has a second pass running beside it from the first
        // await onwards. Both then reach the refill guard before either has set it, and the
        // station asks for two refills for one shortfall. Everything that runs a pass goes through
        // the queue, with no exception for the first one.
        await this.post({ kind: 'restore' });
    }

    /**
     * Stop driving. The player keeps whatever it already holds.
     *
     * Flushes what the throttle owes, which is the whole difference between a
     * graceful shutdown and a kill: a clean stop should not cost the station the
     * last couple of seconds of transitions and replay a record for it.
     */
    async stop(): Promise<void> {
        for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
        if (this.warmTimer) clearInterval(this.warmTimer);
        this.warmTimer = undefined;
        this.rundown.detach();
        await this.flushPersist();
    }

    /**
     * Cancel whatever this reactor was about to do, in the caller's own stack frame.
     *
     * What a writer calls BEFORE posting a command that changes what is on air. A
     * pass may already have gathered its material and be suspended in a database read
     * — `readAir`, `plantBreaks`, a segment lookup — which is exactly where a request
     * handler runs. Only the epoch can reach that pass; a command cannot, because it
     * runs after it, by which time the stale decision has been applied. Without this,
     * a pass resumes past its own guard and appends the OLD programme's records into
     * the running order that has just been retracted for the new one. That was bug 1.
     */
    invalidate(): void {
        this.epoch.bump();
        // A cue is about a particular record in a particular running order; one held across a
        // change of programming attaches itself to the first record of something else entirely.
        this.pendingVoice = undefined;
    }

    /** What the director is doing, for a console that has to draw it. */
    status(): {
        active: boolean;
        airMode: AirMode;
        name?: string;
        source?: string;
        slotId?: string;
        placedBy?: 'operator' | 'schedule';
        remaining: number;
    } {
        return {
            active: this.active,
            airMode: this.airMode,
            ...(this.lineup === undefined ? {} : { name: this.lineup.name, source: this.lineup.source, placedBy: this.lineup.placedBy }),
            // Which slot of the day this broadcast belongs to, which only the running order knows.
            // The schedule holds the slots and the clock decides which one is in force; what is
            // actually AIRING is the director's answer alone, and a console comparing the two is
            // how an operator sees their own takeover holding.
            ...(this.lineup?.slotId === undefined ? {} : { slotId: this.lineup.slotId }),
            remaining: this.lineup?.remaining() ?? 0,
        };
    }

    /**
     * Until when the schedule must leave the running order alone, or `undefined` for no hold.
     *
     * A passthrough, and it earns its line here for the reason {@link status} does: the running
     * order is the sole authority on what is airing, and the tick is a timer that READS. Putting the
     * hold anywhere else would make the schedule a second stateful owner of programming, which is
     * the thing `docs/decisions/on-air-ownership.md` exists to prevent.
     */
    holdUntil(): number | undefined {
        return this.lineup?.holdUntil;
    }

    /**
     * Hold the running order against the schedule, or release it.
     *
     * `Infinity` holds until somebody releases it; `undefined` releases. Persisted immediately
     * rather than on the throttle, because the whole value of a hold is that it survives the restart
     * an operator is not thinking about when they set it.
     */
    async holdAgainstSchedule(until?: number): Promise<void> {
        if (this.lineup === undefined) return;

        this.lineup.hold(until);
        await this.persist();
    }

    /**
     * How long the commit pass has been unable to commit for want of the audio, or `undefined`
     * when that is not what is holding it up.
     *
     * The one thing that tells a running order which has RUN OUT apart from one that is full and
     * cold, which look identical from outside: both leave the transport holding nothing. It is the
     * same instant {@link noteAudioWait} reports on the feed after a minute, published here so the
     * silence diagnosis can say which of the two an operator is looking at — "the refills are
     * failing" and "the next record is still downloading" want opposite responses, and until this
     * existed the console gave the first answer for both.
     *
     * Set and cleared by the commit pass rather than by a clock, so it means "nothing has been
     * committed since", which stays true whether the bytes are still coming or nothing has looked
     * lately. Whoever reads it words its sentence around that rather than around the fetch.
     */
    audioWaitSince(): number | undefined {
        return this.waitingOnAudioSince;
    }

    /**
     * How many records in the warm window have their bytes actually on the way.
     *
     * The other half of {@link audioWaitSince}, and what turns it from one sentence into two. A wait
     * with fetches behind it is a station warming up, which is working; the same wait with nothing
     * behind it is a station stuck, which is not. Neither the transport nor the diagnosis can see
     * this — it comes off the ripener's own read of the window, on the commit pass — so it is
     * published here for the same reason the wait itself is.
     *
     * Stale by at most one pass, deliberately: it is whatever the last ripen found, so a fetch that
     * completed a second ago still reads as warming until the next pass looks. That is the right
     * direction to be wrong in, since the alternative is a station briefly reporting itself stuck
     * between a download finishing and the pass that notices.
     */
    warmingRecords(): number {
        return this.warming;
    }

    /**
     * Whether what the player is holding right now is a holding message and nothing else.
     *
     * The fact that keeps the silence diagnosis honest once the station has something to SAY about
     * warming up. `Rundown.hasProgramme()` is true of anything queued, so a warm-up segment on its
     * way to the mount reads as programme and the whole chain answers `airing` — the station
     * reporting that it is broadcasting its show while it loops "give us a moment". That is the same
     * class of mistake as `starved`, where a listener hears SOMETHING and that is exactly what makes
     * it hard to notice.
     *
     * Answered here rather than by the transport because a `RundownItem` does not carry the segment
     * kind: a segment reaches the player as an item with a URL, and which KIND it was is a fact only
     * the running order still holds.
     */
    holdingWarmUp(): boolean {
        const items = this.lineup?.all() ?? [];
        return items.some(
            item => item.kind === 'segment' && item.segmentKind === WARMUP_KIND && (item.state === 'handed' || item.state === 'airing'),
        );
    }

    /**
     * The running order as it stands, for a console that has to draw it.
     *
     * A snapshot rather than the object, so a caller cannot edit what is on air by
     * holding a reference to it. Editing is a command; see {@link applyEdit}.
     */
    order(): StationLineupSnapshot | undefined {
        return this.lineup?.toSnapshot();
    }

    /**
     * Apply somebody's change to the running order, and say whether it took.
     *
     * The way in for the console. It goes through the queue like everything else, so
     * an operator's shuffle cannot land in the middle of a commit pass — and it is
     * applied HERE rather than by the caller, because there is no second copy of the
     * order to edit.
     */
    async applyEdit(edit: OrderEdit): Promise<EditResult> {
        const result = await this.post({ kind: 'edit', edit });
        // The edit arm always answers. The type is wide because most commands have nothing to say
        // and one of them says something else, not because this one might stay silent.
        return isEditResult(result) ? result : { ok: false, reason: 'not-found', message: 'the station has nothing on air to edit' };
    }

    /**
     * Put the station back on air with the order it already has. Answers whether there was one.
     *
     * Distinct from {@link putOnAir} in the way an operator means it to be: Stop leaves the running
     * order alone, and this picks it up where it stopped rather than replacing it.
     */
    /**
     * Ask the station to say something, and find out whether it will.
     *
     * The way in for anything that is not the running order's own rules: the audience watch, a news
     * poller, an operator at the desk. It goes through the queue like every other writer, so a
     * request cannot land in the middle of a commit pass — and the position is decided HERE, because
     * a producer knows that something happened and only this knows what is still free.
     */
    async requestBreak(request: BreakRequest): Promise<BreakRequestResult> {
        const result = await this.post({ kind: 'requestBreak', request });

        return isBreakRequestResult(result) ? result : { accepted: false, reason: 'the station had nothing to say about that request' };
    }

    async resumeAir(): Promise<ResumeResult> {
        const result = await this.post({ kind: 'resume' });

        return isResumeResult(result) ? result : { resumed: false };
    }

    /**
     * Read `station_air`, load the running order, and commit if the station is meant
     * to be on.
     *
     * The one place `active` is read from storage rather than believed. A station
     * stood down before a restart must not put itself back on air, and the only
     * thing that knows it was stood down is the row.
     */
    private async restore(): Promise<void> {
        this.epoch.bump();
        this.pendingVoice = undefined;
        const air = await this.readAir(true);
        this.active = air?.active ?? false;

        this.lineup = await inScope(this.container, async scope => scope.get(StationLineupRepository).load());
        if (!this.lineup) return;

        // The SAME broadcast, not a new one: the row carried its id, so a restart mid-programme
        // files what happens next under the show that was already running.
        this.identity.began(this.lineup.broadcastId);

        // The transport drives the order directly from here on. It owns each item's transport
        // state and this class owns the order; there is no second copy for the two to disagree
        // about, which is what step 8 of the decision bought.
        this.rundown.attach(this.lineup);

        // Everything the player was holding belongs to a process that is gone. The items
        // themselves are still in the order, saying they were handed over, and nothing has
        // heard them — so they are offered again rather than skipped. This is the same
        // correction a retraction makes, applied to the retraction a restart IS.
        const reclaimed = this.lineup.reclaimAll();
        if (reclaimed > 0) {
            this.logger.info('director: taking back what a previous process had handed over', { items: reclaimed });
            await this.persist();
        }

        // **What makes a restart recoverable.** The item the row says is airing is prepared
        // before anything else, so the first reading of the player names something this process
        // can speak for. Without it the app comes back unable to recognise its own broadcast and
        // stands the clock down over a track a listener is still hearing.
        const airing = this.lineup.airing();
        if (airing) {
            await this.prepareForPlayer([airing]);
            this.logger.info('director: picking up the item a previous process left on air', { item: airing.id });
        }

        if (this.active) await this.commit();
    }

    /** Ask for a commit pass from a listener, swallowing anything it throws. */
    private wake(): void {
        this.send({ kind: 'wake' });
    }

    /**
     * Ask again, but only while there is something the asking could change.
     *
     * The gate is the whole design. `waitingOnAudioSince` is set and cleared by {@link noteAudioWait}
     * on every commit pass, so it means precisely "the last pass found candidates and committed none
     * of them for want of their bytes" — which is the one state a pass nobody triggered can get the
     * station out of. On a healthy station this method is two comparisons every few seconds and
     * posts nothing, and a station that recovers stops posting the moment it commits, without
     * anything having to turn the loop off.
     *
     * The beat is taken on every tick rather than only on one that posts, because what the heartbeat
     * measures is whether the loop is going round. A tick that correctly decided to do nothing is a
     * pass, exactly as `PlayoutPusher.reconcile`'s several early returns are.
     */
    private warmTick(): void {
        this.heartbeat.beat(HEARTBEATS.directorWarm);
        if (!this.active || this.waitingOnAudioSince === undefined) return;

        this.wake();
    }

    /**
     * Post a command with nobody to hand a failure to.
     *
     * What every listener uses. They run on the pusher's loop or on a track boundary, so there is
     * no caller to reject to and an uncaught one would take the process down for something the next
     * event retries anyway. A caller that DOES want the outcome awaits {@link post} instead.
     */
    private send(command: DirectorCommand): void {
        void this.post(command).catch(error => this.logger.warn(`director: a ${command.kind} command failed (${errorText(error)})`));
    }

    /**
     * Hand the director something to do, and wait for it to be done.
     *
     * The way in for anything outside this class. Commands are handled one at a time and in order,
     * so a caller is not racing the reactor's own work: see {@link DirectorMailbox}.
     */
    async post(command: DirectorCommand): Promise<DirectorCommandResult> {
        return await this.mailbox.post(command);
    }

    /**
     * What each command actually does.
     *
     * Deliberately thin. A command names a decision and this routes it; the work stays in the
     * methods that already do it, so the mailbox is a way IN rather than a second place where the
     * station's behaviour lives.
     */
    private async handle(command: DirectorCommand): Promise<DirectorCommandResult> {
        switch (command.kind) {
            case 'wake':
                await this.commit();
                return undefined;

            case 'restore':
                await this.restore();
                return undefined;

            case 'resume':
                return await this.resume();

            case 'standDown':
                await this.standDown();
                return undefined;

            case 'putOnAir':
                await this.putOnAir(command.binding, command.tracks);
                return undefined;

            case 'appendTracks':
                await this.appendTracks(command.tracks);
                return undefined;

            case 'replaceTail':
                await this.replaceTail(command.tracks);
                return undefined;

            case 'rebrief':
                await this.rebrief(command.brief);
                return undefined;

            case 'recast':
                await this.recast(command.bind);
                return undefined;

            case 'edit':
                return await this.edit(command.edit);

            case 'requestBreak':
                return await this.takeRequest(command.request);
        }
    }

    /**
     * Somebody asked the station to say something.
     *
     * The whole of what this adds to `plantBreaks` beside it is the two things a REQUEST has that a
     * planted break does not: a cooldown, because a producer watching an edge can see the same edge
     * twice, and a row, because the moment it describes cannot be re-derived from the running order
     * the way a spacing rule can.
     *
     * Declines rather than throws all the way down. A station that is off air, a cooldown that has
     * not run out, an order with no room, a kind nothing can write: all ordinary, all with a sentence
     * for whoever is reading.
     */
    private async takeRequest(request: BreakRequest): Promise<BreakRequestResult> {
        if (!this.active || this.lineup === undefined) {
            return { accepted: false, reason: 'the station is not airing anything to put a break into' };
        }
        const lineup = this.lineup;

        try {
            return await inScope(this.container, async scope => {
                const requests = scope.get(BreakRequestRepository);

                // Asked of the TABLE rather than of a map here, and that is what makes it survive a
                // restart — which is exactly when it matters most, since a restart makes every
                // listener look like a fresh arrival at once.
                if (request.key !== undefined && request.cooldownMs !== undefined) {
                    if (await requests.acceptedSince(request.key, Date.now() - request.cooldownMs)) {
                        return { accepted: false, reason: `the station already took a ${request.kind} recently` };
                    }
                }

                const rules = resolveRules(lineup.mode, lineup.rules, stationRules(this.config));
                const planner = scope.get(BreakPlanner);

                // Asked BEFORE the row is written, so the table does not fill with requests for a
                // kind this station has no writer or no voice for.
                const refusal = planner.cannotProduce(request.kind, rules);
                if (refusal !== undefined) {
                    this.logger.info('director: declined a request to say something', { kind: request.kind, reason: refusal });
                    return { accepted: false, reason: refusal };
                }

                // The two halves of the seam. An urgent request is written down as `pending` and takes
                // no position at all until its audio exists; a routine one is planted exactly like a
                // break the station planned for itself, and takes the same chances at its slot.
                if (isRenderedFirst(request.urgency)) return await this.prepareRequest(requests, planner, rules, request);

                const stored = await requests.open(request, 'placed');
                const result = await planner.plantRequested(lineup, rules, this.airClock(lineup), stored);

                if (!result.accepted) {
                    // Failed rather than deleted, exactly as `BreakPlanner.abandon` retires a row the
                    // order refused: it carries the reason and is inert, instead of sitting in the
                    // table looking like a break that is still coming.
                    await requests.moveTo(stored.id, 'failed', 'placed');
                    this.logger.info('director: declined a request to say something', { kind: request.kind, reason: result.reason });
                    return result;
                }

                await requests.attachSegment(stored.id, result.segmentId!);
                // Written THROUGH rather than soon, and for `plantBreaks`'s reason: what is about to
                // be asked for is the words of a break in this order, and the job that writes them
                // reads the order from the row. With the ordinary throttle it would find no
                // neighbours and defer, which costs a boundary for nothing.
                await this.flushPersist();
                await this.jobs.send('director.write_break', { segmentId: result.segmentId! });

                this.announce(stored.id, request);
                return result;
            });
        } catch (error) {
            // Swallowed for the reason a planting failure is: a break is the one thing in a pass the
            // broadcast does not depend on, and a request that could not be written down must not
            // take down the station it was asking to speak.
            this.logger.warn(`director: could not take a request to say something (${errorText(error)})`);
            return { accepted: false, reason: 'the station could not write the request down' };
        }
    }

    /**
     * Take a request that must be heard, by writing everything and placing nothing.
     *
     * The urgent half. A break asked for because something HAPPENED gets no slot until its audio
     * exists, because the alternative is the failure this whole path is built to avoid: a segment
     * that reaches its slot unready is skipped, and there is no second welcome coming for a listener
     * who has already arrived.
     *
     * So this writes the row, plans the segment, and sends the write job — and {@link injectReady},
     * on a later pass, is what finds a position for it once the renderer is done. Nothing about the
     * running order is touched here at all, which is also why it needs no `flushPersist`.
     */
    private async prepareRequest(
        requests: BreakRequestRepository,
        planner: BreakPlanner,
        rules: ResolvedRules,
        request: BreakRequest,
    ): Promise<BreakRequestResult> {
        const expiresAt = expiryFor(request.urgency);
        const stored = await requests.open(request, 'pending', expiresAt === undefined ? undefined : Date.now() + expiresAt);

        const prepared = await planner.prepareRequested(rules, stored);
        if ('reason' in prepared) {
            await requests.moveTo(stored.id, 'failed', 'pending');
            this.logger.info('director: declined a request to say something', { kind: request.kind, reason: prepared.reason });
            return { accepted: false, reason: prepared.reason };
        }

        await requests.attachSegment(stored.id, prepared.segmentId);
        await this.jobs.send('director.write_break', { segmentId: prepared.segmentId });

        this.logger.info('director: preparing a break to be heard as soon as it exists', {
            kind: request.kind,
            urgency: request.urgency,
            source: request.source,
        });
        this.announce(stored.id, request);
        return { accepted: true, requestId: stored.id, segmentId: prepared.segmentId };
    }

    /** Say on the feed that the station was asked for something. Accepted requests only. */
    private announce(requestId: string, request: BreakRequest): void {
        void this.activity.record({
            module: 'director',
            kind: 'break.requested',
            // The station's own sentence: a producer's `reason` is app-written by the same rule that
            // governs everything else on this feed.
            detail: `The station was asked for a ${request.kind}${request.reason ? `: ${request.reason}` : ''}.`,
            data: { requestId, kind: request.kind, urgency: request.urgency, source: request.source },
        });
    }

    /**
     * Give the breaks whose audio now exists a place in the running order, and retire the ones whose
     * moment has passed.
     *
     * Run from the commit pass, before anything is planted or handed over, on the same argument that
     * puts planting there: a break injected this pass has to be in the order before the pass takes
     * anything out of it.
     *
     * **It notices for itself rather than being told.** The render job could post the moment a
     * segment is spoken, and it deliberately does not: `render` is registered before `director` in
     * `modules.ts`, so a job reaching for this class would invert the module edge. Reading the
     * segment's own state here needs nothing from the renderer, cannot be lost the way a message can,
     * and costs one indexed query per pass that answers nothing on the overwhelming majority of them.
     *

     * **It is also where a lost write is asked for again.** `BreakPlanner.ripen` re-offers every
     * `planned` break in its window on every boundary, which is what makes a dropped job free
     * everywhere else in the director — and it cannot cover this one, because it walks the running
     * order and a break waiting for its audio is deliberately not in it. So the re-offer lives here,
     * on the pass that is already reading these rows.
     *
     * **Expiry is the half that keeps this honest.** A break held back until its audio exists is a
     * break that can be held back forever, and airing one late is worse than not airing it: a
     * bulletin that took twenty minutes to write and speak is not news, and a welcome for a listener
     * who left ten minutes ago is a station talking to an empty room. So a request past its deadline
     * is retired here whether or not it ever became ready, and its segment is failed rather than
     * deleted — carrying the reason, and inert.
     *
     * Everything is swallowed, exactly as `plantBreaks` is: the records either side play regardless.
     */
    /**
     * Put a finished production into the running order, whole.
     *
     * **Nothing is placed until EVERY beat is `ready`.** A production with beat 4 still rendering is
     * not a shorter production, it is a programme that stops mid-sentence — the opposite of the rule
     * governing an ordinary break, which is skipped when it is not ready precisely because another
     * one is along shortly and silence is the worse outcome.
     *
     * **What goes in is ONE item where the beats were joined**, which is the ordinary case on a
     * station with an analyzer, and the block of beats where they were not. The second is not a
     * compatibility path kept alive: it is what a station with no analyzer gets permanently, and it
     * is what every station got before anything could join audio.
     *
     * That all-or-nothing wait is what lets the rest of the transport stay exactly as it was. Since
     * a block only ever enters the order with every beat already spoken, the ordinary "a segment that
     * is not ready is skipped, never waited for" rule needs no exception for productions, and nothing
     * downstream of here had to learn what one is.
     *
     * It NOTICES rather than being told, like {@link injectReady}: the produce job could post when
     * the last beat is spoken and deliberately does not, because `productions` is registered after
     * `director` in `modules.ts` and a job reaching for this class would invert the module edge.
     * Reading the rows here needs nothing from that module and cannot be lost the way a message can.
     *
     * **The same noticing is what asks for the JOIN.** Once every beat is spoken the beats can be
     * made into one piece of audio, and the pass that discovers that is this one — so a production
     * still `rendering` is moved to `stitching` and `render.stitch_production` is sent, and it comes
     * back `ready` whether the join worked or not. Nothing about the join is required: a station
     * with no analyzer, or one whose analyzer cannot join, reaches `ready` with no joined row and the
     * beats go in as a block exactly as they always did.
     *
     * Everything is swallowed, as with planting and break injection: a production that could not be
     * placed this pass is placed on the next one, and the records either side play regardless.
     */
    private async injectProductions(lineup: StationLineup): Promise<void> {
        try {
            await inScope(this.container, async scope => {
                const productions = scope.get(ProductionRepository);
                const waiting = (await productions.unfinished()).filter(
                    production => production.state === 'rendering' || production.state === 'ready',
                );
                if (waiting.length === 0) return;

                const segments = scope.get(SegmentRepository);
                let placed = 0;

                for (const production of waiting) {
                    const beats = await segments.beatsOf(production.id);
                    if (beats.length === 0) continue;

                    // A beat that could not be spoken takes the production with it, because the
                    // alternative is airing a programme with a hole where that beat was. The row
                    // carries the reason for whoever asks.
                    const broken = beats.find(beat => beat.state === 'failed');
                    if (broken !== undefined) {
                        await productions.fail(production.id, `a beat could not be spoken: ${broken.error ?? 'no reason recorded'}`);
                        continue;
                    }

                    // Still being spoken. The ordinary state on most passes, since the whole point is
                    // that the audio comes before the position.
                    if (!beats.every(beat => beat.state === 'ready')) continue;

                    // Every beat is spoken and none of them has been joined yet, so ask for that
                    // before looking for a slot. It is the same noticing this method already does one
                    // stage earlier, and it is here rather than in the produce job because the beats
                    // become joinable minutes after the last pass returned — when the RENDER jobs
                    // behind them finish, which nothing else is watching.
                    if (production.state === 'rendering') {
                        if (await productions.moveTo(production.id, 'stitching', 'rendering')) {
                            await this.jobs.send('render.stitch_production', { productionId: production.id });
                        }
                        continue;
                    }

                    const at = this.slotForProduction(lineup);
                    // No room yet. Left `ready` rather than failed: the audio still exists, and the
                    // next pass has a longer order to put it in.
                    if (at === undefined) continue;

                    // One item where the beats were joined, and the block where they were not. The
                    // fallback is not a compatibility path: it is what a station with no analyzer
                    // gets, permanently, and it is the shape this has always had.
                    const joined = await segments.joinedOf(production.id);

                    // Still a GROUP, even when it is one item. `groupId` is how everything else in
                    // the director knows a segment is part of a programme rather than a disposable
                    // break — `releaseUnheardProductions` hands back an episode a changeover never
                    // played, and `remove` takes a block out whole — and a joined production placed
                    // as a bare segment would be invisible to all of it.
                    const result = lineup.insertGroup(
                        production.id,
                        joined === undefined ? beats.map(beat => beat.id) : [joined.id],
                        at,
                        production.kind,
                    );
                    if (!result.ok) continue;

                    await productions.moveTo(production.id, 'aired', 'ready');
                    placed += 1;
                    this.logger.info('director: put a production into the running order', {
                        production: production.id,
                        title: production.title,
                        beats: beats.length,
                        joined: joined?.id,
                        at,
                    });
                    void this.activity.record({
                        module: 'director',
                        kind: 'production.aired',
                        // Which of the two it was, on the feed rather than only in the log: a
                        // programme that went in as seven items is a different thing to listen to
                        // than one that went in as one, and an operator who changed the gap setting
                        // and heard nothing different is owed the reason.
                        detail:
                            joined === undefined
                                ? `"${production.title}" went into the running order as ${beats.length} separate beats.`
                                : `"${production.title}" went into the running order as one piece, ${beats.length} beats long.`,
                        data: { productionId: production.id, beats: beats.length, joined: joined !== undefined },
                    });
                }

                // Written through rather than soon, for the reason the break injection is: the order
                // now holds something a later pass in this same second would otherwise not see.
                if (placed > 0) await this.flushPersist();
            });
        } catch (error) {
            this.logger.warn(`director: could not place a finished production (${errorText(error)})`);
        }
    }

    /**
     * Where a production can go: the first boundary past what is committed.
     *
     * The same answer `injectRequested` gives a break whose audio already exists, and for the same
     * reason — the words are spoken and the only thing left is a position, so it takes the earliest
     * one the order will accept. A boundary already holding a segment is walked past, because putting
     * a programme immediately after a talk break is two lots of talking in a row.
     */
    private slotForProduction(lineup: StationLineup): number | undefined {
        const items = lineup.all();
        for (let index = Math.max(0, lineup.committedThrough()); index < items.length; index++) {
            if (items[index]!.kind === 'segment') continue;
            return index;
        }
        return undefined;
    }

    private async injectReady(lineup: StationLineup): Promise<void> {
        try {
            await inScope(this.container, async scope => {
                const requests = scope.get(BreakRequestRepository);
                const waiting = await requests.waiting();
                if (waiting.length === 0) return;

                const planner = scope.get(BreakPlanner);
                const segments = scope.get(SegmentRepository);
                let placed = 0;

                for (const request of waiting) {
                    if (request.expiresAt !== undefined && Date.now() >= request.expiresAt) {
                        await this.expire(requests, segments, request);
                        continue;
                    }
                    // A holding message is only true while the station is still holding. Its urgency
                    // gives it fifteen minutes, which is right for a break ABOUT a record and badly
                    // wrong for one whose entire content is "music in a moment": once a record has
                    // committed, that sentence airs between two songs as a non-sequitur.
                    //
                    // Measured on the station: the spoken warm-up reached `ready` thirteen seconds
                    // after it was asked for, by which time the first download had landed and the
                    // station had been airing for eight of them. So the clock this is judged against
                    // is not a deadline but the WAIT itself — the thing it exists to cover — and a
                    // warm-up that missed its moment is over rather than merely late.
                    if (request.kind === WARMUP_KIND && this.waitingOnAudioSince === undefined) {
                        await this.expire(requests, segments, request);
                        continue;
                    }
                    if (request.segmentId === undefined) continue;

                    const segment = await segments.findById(request.segmentId);
                    if (segment === undefined) {
                        await requests.moveTo(request.id, 'failed', ['pending', 'ready']);
                        continue;
                    }
                    // Nothing could write it, or nothing could speak it. The reason is already on the
                    // segment row; this is only the request agreeing that it is over — but only once
                    // the render has actually had its chances. A break outside the running order gets
                    // none of them by default, because `retryRenders` walks the order and this segment
                    // deliberately has no position, so a render that lost the race with plugin startup
                    // used to end a welcome outright. The planner owns the bound.
                    if (segment.state === 'failed') {
                        if (await planner.retryRenderOf(segment)) continue;
                        await requests.moveTo(request.id, 'failed', ['pending', 'ready']);
                        continue;
                    }
                    // Nothing has claimed it. Asked for again, exactly as `ripen` re-offers every
                    // `planned` break in its window on every boundary: a break waiting for a slot is
                    // the one kind `ripen` cannot cover, because it walks the running order and this
                    // segment is deliberately outside it. Without this a write job lost to a restart
                    // strands the request silently until it expires, which is the one failure the
                    // whole rendered-first path exists to avoid. The claim makes a duplicate send
                    // free, so this needs no memory of what it has already asked for.
                    if (segment.state === 'planned') {
                        await this.jobs.send('director.write_break', { segmentId: request.segmentId });
                        continue;
                    }
                    // The words are decided and nothing is speaking them. The render-side twin of the
                    // re-offer above, and the state a render leaves behind when the host was not ready
                    // rather than the segment wrong — see `RenderSegmentJob`'s `unavailable` branch.
                    // A duplicate send is free, because `claimForRender` is a conditional update.
                    if (segment.state === 'written') {
                        await planner.retryRenderOf(segment);
                        continue;
                    }
                    // Still being written or spoken: an ordinary state on most passes, since the
                    // whole point is that the words and the audio come first.
                    if (segment.state !== 'ready') continue;

                    // The audio exists. Recorded before the placement is attempted, so an order with
                    // no room leaves behind a request that is waiting for a SLOT rather than one that
                    // still looks like it is waiting for a renderer.
                    await requests.moveTo(request.id, 'ready', 'pending');

                    const at = await planner.injectRequested(lineup, request, request.segmentId);
                    // No room in the order, or the order moved under the insert. Left `ready` rather
                    // than failed: the audio still exists, and the next pass has a longer order to
                    // put it in.
                    if (at === undefined) continue;

                    await requests.moveTo(request.id, 'placed', 'ready');
                    placed += 1;
                    this.logger.info('director: put a break the station was waiting on into the running order', {
                        kind: request.kind,
                        urgency: request.urgency,
                        at,
                    });
                }

                // Written through rather than soon, for the reason a planting pass is: the order now
                // holds a break, and anything reading the row back has to see it.
                if (placed > 0) await this.flushPersist();
            });
        } catch (error) {
            this.logger.warn(`director: could not place a break the station was asked for (${errorText(error)})`);
        }
    }

    /** Retire a request whose moment has passed, and the break that was being made for it. */
    private async expire(requests: BreakRequestRepository, segments: SegmentRepository, request: StoredBreakRequest): Promise<void> {
        if (!(await requests.moveTo(request.id, 'expired', ['pending', 'ready']))) return;

        if (request.segmentId !== undefined) {
            const segment = await segments.findById(request.segmentId);
            // Failed from wherever it got to. A break nobody will hear should not sit in the console's
            // library looking like one that is still coming.
            if (segment !== undefined && segment.state !== 'failed') {
                await segments.markFailed(request.segmentId, 'this break was not ready before the moment it was asked for had passed', segment.state);
            }
        }

        this.logger.info('director: a break the station was asked for was not ready in time', { kind: request.kind, urgency: request.urgency });
        void this.activity.record({
            module: 'director',
            kind: 'break.expired',
            severity: 'warn',
            detail: `A ${request.kind} the station was asked for was not ready in time, so it will not be aired.`,
            data: { requestId: request.id, kind: request.kind, urgency: request.urgency, source: request.source },
        });
    }

    /**
     * Start a new broadcast from material somebody has just read.
     *
     * The running order is REPLACED rather than a stored list being pointed at, which
     * is the shape stage 2 exists for: the source is a playlist, read at this moment,
     * and what the station airs from it is its own. An operator's playlist is
     * therefore never edited by having been aired, and never goes stale by having been
     * imported once.
     */
    private async putOnAir(binding: StationLineupBinding, tracks: readonly RundownTrack[]): Promise<void> {
        // Before the old order is let go of, because it is the only thing that knows an episode was
        // sitting in it. See {@link releaseUnheardProductions}.
        await this.releaseUnheardProductions(this.lineup);
        // Same reason, one step further: the outgoing items are the only record of which breaks were
        // planted into a programme that is about to stop existing. Captured here because `this.lineup`
        // is overwritten below and `replaceFrom` — unlike `replacePlanned` — hands nothing back.
        const outgoing = this.lineup?.all() ?? [];

        // Retract FIRST, then rebuild. What the player is holding belongs to the programme
        // coming off, and leaving it there would air a few records of it behind the new one.
        // What is ON AIR is left alone: changing the programming is not a reason to cut a
        // listener off mid-record.
        this.rundown.retract();

        // A NEW running order object, not the old one rebound. It used to be reused, which was
        // harmless while the only things on it were a binding and a list — both of which were
        // replaced immediately below — and stopped being harmless the moment it carried a broadcast
        // id: reusing the object would keep the previous broadcast's identity, and everything
        // written for the next hour would be filed under the programme that had just come off.
        const lineup = new StationLineup(binding);
        lineup.replaceFrom(tracks);
        this.lineup = lineup;
        // Published before anything can write a row against this broadcast, which includes the
        // `air.on` event a few lines below: a broadcast starting is itself part of the broadcast.
        this.identity.began(lineup.broadcastId);
        this.rundown.attach(lineup);
        // After the new order is in place, because that is what `retireSegments` reads to decide
        // whether a break is still wanted somewhere — and none of the outgoing ones can be, which is
        // the whole difference between this and the edit paths. Without it a changeover left every
        // unwritten break of the programme it replaced sitting `planned` for good: `WriteBreakJob`
        // reads absent-from-the-order as EARLY rather than gone and returns without claiming, and
        // `BreakPlanner.ripen` only ever walks the current order, so nothing offered them again and
        // nothing failed them. They stayed in the console's library looking like breaks still to
        // come. This is not the operator's takeover only — every scheduled changeover comes through
        // here, so a station on a daypart schedule accumulated them indefinitely.
        await this.retireSegments(lineup, outgoing, 'the programme changed before this break could air');
        await this.persist();
        // A whole programme's worth of records at once, and an imported provider playlist is the
        // case that needs it most: nothing ever extends one, so without this its first enrichment
        // would be whenever the quarter hour came round.
        this.askForEnrichment('a new running order');

        await inScope(this.container, async scope => scope.get(StationAirRepository).goOnAir());
        this.standingDown = false;
        this.airReadAt = 0;
        this.active = true;

        this.logger.info('director: put the station on air', { name: binding.name, items: tracks.length, source: binding.source });
        // Voided, like every other event: the recorder never throws, and a broadcast starting must
        // not wait on a row nothing reads to decide anything.
        void this.activity.record({
            module: 'director',
            kind: 'air.on',
            detail: `The station went on air with ${binding.name || 'a new running order'}, ${tracks.length} ${tracks.length === 1 ? 'item' : 'items'} long.`,
            data: { name: binding.name, items: tracks.length, source: binding.source, ...(binding.brief ? { brief: binding.brief } : {}) },
        });
        await this.commit();
    }

    /**
     * Put a finished refill at the end of the running order.
     *
     * **The whole reason a refill posts rather than writing.** `ExtendLineupJob` used to load its
     * own `Lineup`, spend seconds generating, and then append through a revision-guarded store the
     * break planner also wrote through. Whichever of the two got there second had its write
     * silently discarded, and the job logged the tracks it had just lost as `added`. Here there is
     * one instance and one writer, so there is nothing to lose a race to.
     */
    private async appendTracks(tracks: readonly RundownTrack[]): Promise<void> {
        if (tracks.length === 0 || !this.lineup) return;

        this.lineup.append(tracks);
        // Breaks are NOT planted here. The next pass walks the whole tail and plants every slot
        // it finds in one write, so doing it now would buy a boundary's latency and a second
        // writer. See `BreakPlanner.plant` and `placementsFor`.
        await this.persist();
        this.askForEnrichment('a refill');
        await this.commit();
    }

    /**
     * Put a finished replan where everything still planned was.
     *
     * The other end of `ReplanLineupJob`, and the reason the swap is one command: the records
     * arrive already chosen and already resolved, so the running order is never without a tail for
     * longer than an array assignment. Everything the player is holding, and everything already
     * spent, keeps its place — see `StationLineup.replacePlanned`.
     *
     * **An empty replacement does nothing at all.** The job guards this too, and it is guarded
     * twice on purpose: emptying the running order is exactly how the station loses its mount
     * lease, and this is the last place that can refuse to.
     */
    private async replaceTail(tracks: readonly RundownTrack[]): Promise<void> {
        if (!this.lineup) return;
        if (tracks.length === 0) {
            this.logger.warn('director: a replan arrived with no records, so the running order was left alone');
            return;
        }

        const dropped = this.lineup.replacePlanned(tracks);
        // Written down before anything else, for the reason `edit` gives: the swap has happened,
        // and a swap that was not written down is the bug. Breaks are not planted here either —
        // the next pass walks the whole tail and plants every slot in one write.
        await this.persist();
        // After the persist, like the refill's: the walk reads the running order from the row, and
        // sending first would have it prioritise the tail that has just been thrown away. Every
        // record in this one is new, so it is the strongest case there is for asking.
        this.askForEnrichment('a replan');
        // The quiet half. A break planted into the old tail is describing a moment that will never
        // come round, and one being written right now would finish and sit in the library looking
        // like a break that is still coming.
        await this.retireSegments(this.lineup, dropped, 'the operator replanned the running order');
        await this.commit();

        this.logger.info('director: replaced the rest of the running order', { added: tracks.length, dropped: dropped.length });
    }

    /**
     * Change what the operator has asked this broadcast to play.
     *
     * **Written THROUGH rather than soon**, and that is the whole of why this is not a one-liner:
     * the next thing to read the brief is `ReplanLineupJob`, from the ROW, and the throttle would
     * have it programme the fresh hour against the brief the operator has just replaced.
     * {@link persist} rather than {@link flushPersist}, which only settles a write the throttle
     * already owes and would do nothing at all after a change nobody else had asked to store.
     *
     * Nothing is committed and nothing is retracted, because a brief says nothing about the records
     * already in the order. What acts on it is whatever generates next: the replan this usually
     * arrives in front of, and every refill for the rest of the broadcast.
     */
    private async rebrief(brief?: string): Promise<void> {
        if (!this.lineup) return;

        this.lineup.rebrief(brief);
        await this.persist();
        this.logger.info('director: the broadcast was re-briefed', { brief: brief ?? '' });
    }

    /**
     * Change who is presenting, and un-say what the outgoing host had lined up.
     *
     * Two halves, and the FIRST is the durable one. `bind` present means this broadcast was recast
     * and the binding is written THROUGH for {@link rebrief}'s exact reason: `WriteBreakJob` reads
     * the host off the row, so a change riding the throttle would have the next break written by
     * whoever the operator has just replaced. `bind` absent means the STATION's active persona
     * changed, and this broadcast's binding is deliberately not touched — a show that named its own
     * host keeps it, which is `PersonaRepository.presenting`'s precedence and not a rule to reverse
     * from here.
     *
     * The second half is the breaks. A recast changes nothing about the RECORDS, so nothing is
     * committed and nothing is retracted; what it changes is who is about to speak, and the station
     * has usually already written and spoken a couple of breaks in the outgoing character. Those go
     * back to `planned` and `BreakPlanner.ripen` asks for them again — the same repair a broken
     * promise gets, on the same terms: no deadline, and one that is not `ready` when its slot comes
     * round is skipped rather than waited for.
     *
     * **Who was presenting before is never asked, and cannot be.** On the station's own path this
     * runs after the new persona is already active, so the question has no answer left; and it does
     * not need one, because being out of character is a property of the ROW — every break stamped
     * with anybody but the incoming host is one, whether it was written under the outgoing host or
     * under the one before them. `SegmentRepository.recast` asks it that way, which also means a
     * recast that changed nothing matches nothing and this is safe to post whenever it might have.
     *
     * **Only past the cut.** {@link StationLineup.committedThrough} is where the player's hands
     * start, and clearing the script of something already handed over would take the words out from
     * under a break about to air. The whole tail behind it is swept rather than the write-ahead
     * window, because the set is small and a break written early is exactly the one this is for.
     *
     * Swallowed on failure, and that is the point of the `try`: the operator's change of host is
     * durable either way, and a sweep that could not run leaves breaks that are merely in the wrong
     * character, which is what the station would have aired had nothing been built at all.
     */
    private async recast(bind?: { personaId?: string }): Promise<void> {
        if (!this.lineup) return;
        const lineup = this.lineup;

        if (bind !== undefined) {
            lineup.recast(bind.personaId);
            await this.persist();
            this.logger.info('director: the broadcast was recast', { persona: bind.personaId ?? '' });
        }

        try {
            // A read that FAILED leaves the breaks alone rather than falling back to "nobody is
            // presenting", which would put every break in the tail out of character and rewrite the
            // lot over a transient fault. The change of host above is durable either way.
            const incoming = await this.presenting(lineup.personaId);
            if (!incoming.read) return;

            const ids = [
                ...new Set(
                    lineup
                        .all()
                        .slice(lineup.committedThrough())
                        .flatMap(item => (item.kind === 'segment' ? [item.segmentId] : [])),
                ),
            ];
            const rewritten = await inScope(this.container, async scope => scope.get(SegmentRepository).recast(ids, incoming.persona?.id));
            if (rewritten.length === 0) return;

            this.logger.info('director: the station changed presenter, so the breaks the last one wrote will be written again', {
                segments: rewritten,
                persona: incoming.persona?.key,
            });
            this.reportRewriting(rewritten, { one: 'was written by a different presenter', many: 'were written by a different presenter' });
        } catch (error) {
            this.logger.warn(`director: could not re-offer the breaks the outgoing presenter wrote (${errorText(error)})`);
        }
    }

    /**
     * Who is presenting, resolved the one way everything resolves it.
     *
     * Answers whether the question could be ASKED as well as what the answer was, because the two
     * are opposite facts here and `undefined` already means something: a station that has chosen no
     * persona is ordinary everywhere downstream, and a personas table that could not be read must
     * not be mistaken for one. {@link recast} would otherwise read a failed call as every break in
     * the tail being out of character.
     */
    private async presenting(personaId: string | undefined): Promise<{ read: boolean; persona?: Persona }> {
        try {
            const persona = await inScope(this.container, async scope => scope.get(PersonaRepository).presenting(personaId));
            return { read: true, ...(persona === undefined ? {} : { persona }) };
        } catch (error) {
            this.logger.warn(`director: could not read who is presenting (${errorText(error)})`);
            return { read: false };
        }
    }

    /**
     * Tell the enrichment walk the running order has grown.
     *
     * The walk already puts what the station is about to play in front of the rest of the catalog
     * (`LineupPriorityReader`); this is what stops the first run that does so being up to a quarter
     * hour away. It matters because the two things are minutes apart: a record `PickResolver` found
     * at a provider is ingested inside the refill, and the break that talks over it is written within
     * `WRITE_AHEAD` items of the cursor.
     *
     * **After the persist, never before.** The walk reads the running order from the row, and
     * `persist` writes through rather than riding the throttle, so sending first would have it read
     * the order as it stood before the append and pick exactly the wrong batch.
     *
     * **One queue, one job, deliberately.** This is the ordinary `catalog.enrich`, not a priority
     * job beside it: two walks would sit on the same one-request-per-second bucket and starve each
     * other into the timeouts that quarantine a plugin. pg-boss serializes the queue, so a send that
     * arrives mid-walk waits for a run that was already going to do this work.
     *
     * Not awaited and never thrown from, following {@link plantBreaks} and {@link ripenTrackCache}: a
     * broker that will not take a send must not cost the station its running order, and the cron is
     * still there — a lost send costs one quarter hour and nothing else.
     */
    private askForEnrichment(because: string): void {
        void this.jobs.send('catalog.enrich', {}).catch(error => {
            this.logger.warn(`director: could not ask for the new records to be described (${errorText(error)})`, { because });
        });
    }

    /**
     * Somebody at the desk changed the order.
     *
     * Written down before the caller is answered, deliberately, and this is the one
     * place that matters: the response says it happened, so it has to have happened.
     * The transport's own transitions are the other side of that trade — nobody is
     * waiting on those, and the correct failure for them is to replay.
     */
    private async edit(edit: OrderEdit): Promise<EditResult> {
        const lineup = this.lineup;
        if (!lineup) return { ok: false, reason: 'not-found', message: 'the station has nothing on air to edit' };

        const { result, dropped } = this.applyTo(lineup, edit);
        if (!result.ok) return result;

        await this.persist();
        // After the write, because the row is the record and the caller is answered off the
        // edit rather than off this: a break whose words are never collected is untidy, and one
        // whose removal was not written down is the bug.
        if (edit.kind === 'remove') await this.collectRemoved(lineup, edit.itemId);
        // The same half for a shuffle, which drops every break planted into the sequence it just
        // replaced. `BreakPlanner` plants the shuffled tail again on the commit pass below, so what
        // is retired here is only the rows behind the breaks that were describing the old one.
        if (dropped.length > 0) await this.retireSegments(lineup, dropped, 'the operator shuffled the running order');
        // An edit to the tail says nothing about what is already with the player, so nothing is
        // retracted. It can leave room for something new, though — a removal shortens the order —
        // so the pass runs.
        await this.commit();
        return result;
    }

    /**
     * Retire the segment row behind a break the operator has just deleted.
     *
     * The quiet half of the same bug. Removing a break leaves its `deadair.segments` row in
     * whatever state it had reached, and a `director.write_break` job may be in flight for it or
     * may already have written a script for two records it now sits between neither of. Nothing
     * collected it: it sat in the console's library looking like a break that was still coming.
     * This is `BreakPlanner.abandon`'s shape for a removal — failed rather than deleted, so it
     * carries the reason and is inert.
     *
     * Two things it will not touch. **A `ready` segment**, because that is an ident off the shelf
     * or a break whose audio exists, and both are material an operator can put back in; only the
     * unfinished states are this order's to write off. **A segment id still in the order
     * somewhere else**, because idents are planted from a shared library and the same row is
     * legitimately at three slots in an hour — failing it here would take the other two off air.
     *
     * Failures are swallowed, for {@link plantBreaks}'s reason and a stronger one: the edit has
     * already happened and been written down, so throwing here would report a removal that stuck
     * as a removal that failed.
     */
    /**
     * Hand back any produced episode the order coming off never actually played.
     *
     * `injectProductions` marks a production `aired` the moment it puts its beats into the running
     * order, which is right for the ordinary case and wrong for exactly one: with `COMMIT_LEAD` at
     * one, those beats then sit `planned` for a long time. {@link putOnAir} builds a NEW order and
     * lets the old object go, so an episode that was inserted and not yet heard vanished with it,
     * and nothing re-injected it because its own row already claimed it had aired. Three hours of
     * model time, thrown away by a boundary it happened to straddle, silently.
     *
     * Moving it back to `rendering` is all that is needed: the next commit pass walks the unfinished
     * productions, finds its beats still `ready`, and puts it into the new order.
     *
     * **Only when NO beat has been heard.** A part-aired episode is genuinely over — the listener
     * has had the first half of it — and re-injecting from the top would play those beats twice.
     * That is what makes this a narrow repair rather than a rule about what a changeover means.
     *
     * It lives here rather than in the schedule's tick so an operator's changeover is covered by the
     * same code as the clock's, which is the one thing that keeps them from disagreeing. Failures
     * are swallowed for {@link collectRemoved}'s reason: the changeover is happening either way, and
     * an episode that stays marked `aired` is the state this is trying to improve on rather than a
     * reason to stop the station going on air.
     */
    private async releaseUnheardProductions(lineup: StationLineup | undefined): Promise<void> {
        if (lineup === undefined) return;

        // A `groupId` on a segment item is the production it is a beat of; an ordinary break has
        // none. Heard means the player got to it, which is the only thing that makes an episode
        // genuinely spent.
        const heard = new Set<string>();
        const groups = new Set<string>();
        for (const item of lineup.toSnapshot().items) {
            if (item.kind !== 'segment' || item.groupId === undefined) continue;
            groups.add(item.groupId);
            if (item.state === 'airing' || item.state === 'played') heard.add(item.groupId);
        }

        const unheard = [...groups].filter(groupId => !heard.has(groupId));
        if (unheard.length === 0) return;

        try {
            await inScope(this.container, async scope => {
                const productions = scope.get(ProductionRepository);
                for (const productionId of unheard) {
                    // Guarded on `aired`, so this can only ever undo the mark `injectProductions`
                    // made. One that failed, was cancelled or is still being made is left alone.
                    if (!(await productions.moveTo(productionId, 'rendering', 'aired'))) continue;

                    this.logger.info('director: a produced episode was not heard before the programme changed, so it goes back in the queue', {
                        production: productionId,
                    });
                }
            });
        } catch (error) {
            this.logger.warn(`director: could not hand back an unheard production (${errorText(error)})`);
        }
    }

    private async collectRemoved(lineup: StationLineup, itemId: string): Promise<void> {
        const item = lineup.find(itemId);
        if (item?.kind !== 'segment') return;

        await this.retireSegments(lineup, [item], 'the operator removed this break from the running order');
    }

    /**
     * Write off the segment rows behind breaks that have left the running order.
     *
     * The shared half of {@link collectRemoved}, and the two rules in its doc comment are why it is
     * shared rather than written twice: a `ready` segment is material an operator can put back, and
     * a segment id still somewhere else in the order is an ident the station is about to play.
     * Both were learned once and cost a break each; a replan drops a whole tail at a time, so
     * getting either wrong here would be the same mistake several times over.
     *
     * `lineup` is read as it stands AFTER the change, which is what makes the still-wanted check
     * mean anything. It covers both callers because a removal leaves its item in the order marked
     * `removed` — never a reason to keep a row alive — and a replan takes its items out entirely.
     */
    private async retireSegments(lineup: StationLineup, dropped: readonly StationLineupItem[], because: string): Promise<void> {
        const droppedIds = new Set(dropped.map(item => item.id));
        // By segment id rather than by item, because one row legitimately sits at several slots and
        // a tail dropped wholesale can hand over three items naming the same ident.
        const segmentIds = new Set(dropped.filter(item => item.kind === 'segment').map(item => item.segmentId));
        const orphaned = [...segmentIds].filter(
            segmentId =>
                !lineup
                    .all()
                    .some(
                        other => !droppedIds.has(other.id) && other.kind === 'segment' && other.segmentId === segmentId && other.state !== 'removed',
                    ),
        );
        if (orphaned.length === 0) return;

        try {
            await inScope(this.container, async scope => {
                const segments = scope.get(SegmentRepository);
                for (const segmentId of orphaned) {
                    const segment = await segments.findById(segmentId);
                    if (segment === undefined || segment.state === 'ready' || segment.state === 'failed') continue;

                    await segments.markFailed(segmentId, because, segment.state);
                    this.logger.info('director: retired a break that left the running order', { segmentId, from: segment.state, because });
                }
            });
        } catch (error) {
            this.logger.warn(`director: could not retire a break that left the running order (${errorText(error)})`);
        }
    }

    /**
     * Apply one edit, and say what it took out of the order.
     *
     * `dropped` is empty for every edit but the shuffle: the others leave every item where it was,
     * or — for a removal — leave it in the order carrying a mark. Answering in one shape keeps
     * {@link edit} from having to know which of the four is the odd one.
     */
    private applyTo(lineup: StationLineup, edit: OrderEdit): ShuffleResult {
        switch (edit.kind) {
            case 'shuffle':
                return lineup.shuffleRemaining();

            case 'move':
                return { result: lineup.move(edit.itemId, edit.toIndex), dropped: [] };

            case 'remove':
                return { result: lineup.remove(edit.itemId), dropped: [] };

            case 'insertSegment':
                return {
                    result: lineup.insertSegment(
                        edit.segmentId,
                        edit.atIndex ?? lineup.size(),
                        edit.overAtMs === undefined ? undefined : { atMs: edit.overAtMs },
                        edit.segmentKind,
                    ),
                    dropped: [],
                };
        }
    }

    /**
     * Top the running order up to the lead, and deal with an order that has run out.
     *
     * Everything here is driven off what the rundown says it is holding rather
     * than off a count kept here, because the rundown is the one that knows: a
     * push the player never took is re-queued there, and an item skipped for
     * failing to resolve leaves a hole this has to fill.
     */
    private async commit(): Promise<void> {
        // Taken before the first await of the pass, and checked immediately before anything is
        // handed over. Everything below this line runs with the event loop free at each await, and
        // the operator's Stop, a new running order and an edit all land there.
        const token = this.epoch.current();

        // The row is read BEFORE the `active` check, and `active` comes from it.
        // Checking a remembered flag first would mean a station that was off when
        // this process started could never notice being switched on out of band —
        // the flag would only ever be refreshed by a caller that already knew.
        // That is what a scheduler writing this row is, and what a second process
        // would be. Throttled, so a wake every couple of seconds costs one read
        // every {@link AIR_TTL_MS}.
        if (this.standingDown) return;

        const air = await this.readAir();
        this.active = air?.active ?? false;
        if (!this.active) return;

        const lineup = this.lineup;
        if (!lineup) return;

        const rules = resolveRules(lineup.mode, lineup.rules, stationRules(this.config));
        // The transport cannot resolve this for itself — the module edge runs playout <- director —
        // so the commit pass, which resolves the rules anyway, is what tells it. Every pass rather
        // than only on a change of order: it is one assignment, and it is what makes an operator's
        // change take effect within a track or two instead of at the next broadcast.
        this.rundown.setCrossfade(rules.crossfade);

        // FIRST, and before planting: a break the station was asked for and has already spoken is
        // waiting for a position, and everything below this line either takes items out of the order
        // or puts breaks into it. It also retires the ones whose moment has passed, which is what
        // stops a request held back for its audio being held back forever.
        await this.injectReady(lineup);

        // Beside the break injection above and for the same reason: a production whose beats are all
        // spoken is waiting for a position, and everything below either takes items out of the order
        // or puts breaks into it.
        await this.injectProductions(lineup);

        // And what the clock will want LATER. Read ahead rather than filled at a boundary, because
        // making a production is minutes to hours of model time: by the time its slot arrives it is
        // far too late to start. Safe on every pass because it asks the table what is already
        // scheduled rather than remembering.
        await inScope(this.container, async scope => {
            // Told what SHOW it is being commissioned inside, because the running order lives here
            // and nowhere else. A production that inherited neither would be a phone-in about
            // nothing in particular, presented by the station's default persona rather than by the
            // person whose broadcast it is going out in the middle of.
            await scope.get(ProductionScheduler).ripen(Date.now(), {
                ...(lineup.brief.trim().length === 0 ? {} : { brief: lineup.brief }),
                ...(lineup.personaId === undefined ? {} : { personaId: lineup.personaId }),
                // The other half: whether this SHOW takes calls, which is a per-broadcast rule
                // resolved exactly like breaks and spacing are. The id is what the spacing is
                // measured against, so a station put on air twice in an evening does not inherit the
                // first show's clock.
                broadcastId: lineup.broadcastId,
                callins: rules.callins,
                callinEveryMinutes: rules.callinEveryMinutes,
            });
        }).catch(error => this.logger.warn(`director: could not commission scheduled productions (${errorText(error)})`));

        // BEFORE committing, so a break planted this pass is in the order before anything is
        // taken from it. The other way round, the tail would be topped up first and the break
        // would land behind the records that had just been handed over.
        //
        // The refill job plants its own as it appends, which is the common case; this pass is
        // what covers an order nothing ever extends. An imported provider playlist is exactly
        // that: it never runs the generator, so without this it would play an hour of records
        // and never once say what station it is.
        await this.plantBreaks(lineup, rules);

        // BEFORE committing, which is a reversal of where this used to sit. It ran after the
        // hand-over on the argument that the items taken this pass are past the cursor by then, so
        // the window it read held only records that had NOT been handed over — true, and exactly
        // the wrong shape once a record's audio has to be here before it may be committed. The
        // warm window now leads the commit window (`CACHE_AHEAD` against `COMMIT_LEAD`), so asking
        // for audio first means this pass's fetches are aimed several boundaries ahead of what it
        // is about to commit rather than at it.
        await this.ripenTrackCache(lineup);

        // AFTER the ripener and BEFORE the commit block, which is the only placement that works.
        // A measurement is taken on the local file, so it cannot exist until the audio does, and
        // the item has to carry it before `toPlayerItems` stamps a gain from it. Between the two
        // is the one window where both are true.
        await this.remeasure(lineup);

        // AFTER the ripener, so it is judging the wait the last pass left rather than one this pass
        // is about to change, and before the commit block so anything it plants is committable on
        // this pass rather than the next.
        await this.holdWarmUp(lineup, rules);

        const held = this.rundown.upcoming().length;
        if (held < COMMIT_LEAD) {
            // ── gather ──────────────────────────────────────────────────────────────
            // Everything slow, and nothing marked. `nextPlanned` is pure, so a segment that
            // turns out not to be ready — or a database that will not answer — costs this
            // pass and nothing else. Marking items handed first and then doing this work is how
            // a failure in the middle loses programming for good.
            //
            // Note what this pass does NOT do any more: it never marks an item handed. Preparing
            // is telling the transport HOW to play what the order already says; handing over is
            // the transport's own act, and it marks it at the moment it happens. Two things used
            // to claim that transition and the order was whichever ran last.
            //
            // What is asked for is the next planned items the transport does NOT already have.
            // Preparing is idempotent and changes nothing about the order, but it announces a
            // change and a change asks for another pass — so a pass that simply offered the next
            // few planned items would prepare the same ones on every pass and never stop.
            const wanted = COMMIT_LEAD - held;
            // Asked for generously and then cut to `wanted` RECORDS by `takeForLead`: a window
            // sized in candidates is not the same as a window sized in items.
            const candidates = lineup.nextPlanned(COMMIT_LEAD + SEGMENT_SLACK).filter(item => !this.rundown.isPrepared(item.id));
            const taken = takeForLead(await this.withLocalAudio(candidates), wanted);
            // Judged on RECORDS at both ends, which is narrower than it was and is the difference
            // between the wait meaning something and meaning almost nothing. A segment rides the
            // window for free (`SEGMENT_SLACK`) and can be committed while every record behind it is
            // still cold — so a pass that handed over a break and nothing else used to read as a
            // pass that committed, clearing a wait that was entirely still true. What that costs is
            // everything hanging off the wait: the warm ticker stops asking, and the station reports
            // itself as committing normally while it commits no music at all.
            //
            // The other half is the same correction read forwards: an order whose remaining
            // candidates are all segments has nothing to wait FOR, and starting a wait over it would
            // be a station reporting that it cannot get audio it never wanted.
            const wantedRecord = candidates.some(isTrackItem);
            const tookRecord = taken.some(isTrackItem);
            this.noteAudioWait(wantedRecord && !tookRecord);
            const prepared = taken.length === 0 ? undefined : await this.toPlayerItems(taken);

            // ── apply ───────────────────────────────────────────────────────────────
            // One check, then the mutations, with NO await between them. That is what makes
            // the check impossible to go stale rather than merely unlikely to: the event loop
            // cannot run anything in a stretch with nothing to yield at, so the station cannot
            // be stopped underneath this the way it can underneath every await above. See
            // {@link Epoch}.
            if (!this.epoch.isCurrent(token)) return;

            if (prepared) {
                // Committing a RECORD ends the wait, so a station that recovers stops saying it is
                // stuck and the next stall is reported afresh. A segment does not, and that is the
                // same narrowing `noteAudioWait` takes above rather than a second rule: a break
                // rides the window for free, so "committed something" was true of a pass that
                // handed over one break and no music — and, because `toPlayerItems` SKIPS a segment
                // that is not ready, it was true even of a pass that committed nothing whatsoever.
                // Either way the wait was cleared while every word of it was still the case, which
                // stopped the warm ticker and had the station report itself as keeping up.
                if (tookRecord) {
                    this.waitingOnAudioSince = undefined;
                    this.waitingOnAudioReported = false;
                }
                this.rundown.prepare(prepared.items);
                for (const itemId of prepared.skipped) lineup.markSkipped(itemId);
                for (const itemId of prepared.unavailable) lineup.markUnavailable(itemId);

                // The order moved, so a refill decision made a moment ago is stale.
                if (lineup.remaining() >= EXTEND_BELOW) this.extendSentAt = undefined;
                // A break may have promised one of the records that just came out. Sent rather
                // than awaited, and after the mutations, because the promise is already broken —
                // the claim check would drop the break at hand-over either way — and this is only
                // the attempt to have something true to say instead. See `reopenPromises`.
                void this.reopenPromises(prepared.unavailable);
                // Throttled. Nobody is waiting on this, and both ways of being late fail the same
                // direction: the record says less has been committed than has, so the recovery
                // replays rather than skips. For a station whose order is read back at boot,
                // hearing a record again is the cheaper of the two.
                this.persistSoon();
            }
        }

        if (lineup.isExhausted()) {
            await this.finish(lineup, rules);
            return;
        }

        await this.topUpIfShort(lineup, rules);
    }

    /**
     * The head of a candidate list, cut at the first record whose audio is not on this machine.
     *
     * **The precondition the whole shape exists for.** A record is committed only once its bytes are
     * here, so Liquidsoap's resolve is a read from this app rather than a provider download inside
     * the request it is waiting on. See `docs/decisions/bytes-before-air.md`.
     *
     * It CUTS rather than filters, and that is the load-bearing half. Filtering would commit the warm
     * items and leave the cold one behind them, which reorders the running order — an operator's
     * sequence rearranged by which downloads happened to finish first, silently. Stopping at the
     * first cold record holds its slot instead: the ripener is fetching several boundaries ahead, so
     * the ordinary case is that the bytes land before the slot does, and the pass comes round again
     * on the next rundown change.
     *
     * A segment passes straight through. Its readiness is its own `segments.state`, and
     * {@link toPlayerItems} SKIPS one that is not ready rather than waiting for it — deliberately the
     * opposite rule, because a break is disposable and a record is not.
     *
     * A record the catalog has never seen has no binding to be ready, so it passes through too and
     * answers for itself at hand-over, exactly as it does for the bench check in
     * {@link toPlayerItems}.
     *
     * Failing to READ readiness is not a reason to commit nothing: an unreachable database would
     * otherwise take the station off air within three items. It answers with the candidates unchanged
     * and lets the hand-over fetch, which is what the tree did before this rule existed.
     */
    private async withLocalAudio(candidates: readonly StationLineupItem[]): Promise<StationLineupItem[]> {
        const bindings = candidates.filter(isTrackItem).map(item => ({ pluginId: item.track.pluginId, externalId: item.track.externalId }));
        if (bindings.length === 0) return [...candidates];

        const ready = await inScope(this.container, scope => scope.get(TrackAudioService).readyFor(bindings)).catch(error => {
            this.logger.warn(`director: could not tell which records are already here, so committing without checking (${errorText(error)})`);
            return undefined;
        });
        if (ready === undefined) return [...candidates];

        // `trackId === undefined` is checked FIRST, and it is what makes the docstring above true
        // rather than merely intended. `readyFor` builds its set out of `findForBindings`, which
        // joins from `track_sources`, so a record the catalog has never seen is absent from the
        // answer exactly as a benched one is — and this cut therefore stopped dead at it. That is
        // not a wait it could ever come out of: with no binding there is no `track_sources.id` to
        // fetch, so the head of a freshly imported playlist was a permanent wall rather than a
        // record a boundary away.
        const cut = candidates.findIndex(item => isTrackItem(item) && item.track.trackId !== undefined && !ready.has(bindingKey(item.track)));

        return cut === -1 ? [...candidates] : candidates.slice(0, cut);
    }

    /**
     * Say once, on the edge, that the station has a running order it cannot commit from.
     *
     * On the EDGE and after a delay, per the feed's rule: the commit pass runs on every rundown
     * change, so a row per pass would be a log file with a primary key. The delay is what tells the
     * ordinary case — a record still downloading, which is most of a minute on a big file — from the
     * one worth reporting, where the station has been unable to commit anything for long enough that
     * the player is going to run dry.
     *
     * Cleared as soon as anything commits, so a station that recovers stops saying it.
     */
    private noteAudioWait(waiting: boolean): void {
        if (!waiting) {
            this.waitingOnAudioSince = undefined;
            return;
        }

        const now = Date.now();
        this.waitingOnAudioSince ??= now;
        if (this.waitingOnAudioReported || now - this.waitingOnAudioSince < WAITING_ON_AUDIO_MS) return;

        this.waitingOnAudioReported = true;
        this.logger.warn('director: nothing in the running order has its audio yet, so the station is committing nothing');
        void this.activity.record({
            module: 'director',
            kind: 'order.waitingOnAudio',
            severity: 'warn',
            detail:
                `The station has a running order but none of the next items has its audio on this machine yet, ` +
                `so nothing has been committed for ${Math.round((now - this.waitingOnAudioSince) / 1000)}s.`,
            data: { waitingMs: now - this.waitingOnAudioSince },
        });
    }

    /**
     * Get the audio of the next few records in hand before their slots arrive.
     *
     * Runs BEFORE the commit block, and its window leads it: the point is that a record's bytes are
     * here several boundaries before its slot, so the pull never happens inside the request
     * Liquidsoap is waiting on.
     *
     * Failures are still swallowed, exactly as {@link plantBreaks}'s are, but the reason has narrowed
     * and is worth stating precisely. It used to be that the records either side play regardless. That
     * is no longer true of the record this failed to fetch — a record with no local audio is one the
     * commit pass declines to commit. What is still true is that a planner that cannot read its rows
     * must not take down the pass that keeps the running order full, and that a fetch missed on this
     * pass is retried on the next one, which is a boundary away.
     */
    private async ripenTrackCache(lineup: StationLineup): Promise<void> {
        try {
            const { unfetchable, warming } = await inScope(this.container, scope => scope.get(TrackCachePlanner).ripen(lineup));
            this.warming = warming;
            this.thin(lineup, unfetchable);
        } catch (error) {
            // The count is left where it was rather than zeroed. A planner that could not read its
            // rows knows nothing about what is in flight, and answering zero would say the positive
            // thing "nothing is coming" — which is what turns the station's own report from warming
            // into stuck over a transient database fault. Failing to look is not evidence.
            this.logger.warn(`director: could not fetch a record ahead of its slot (${errorText(error)})`);
        }
    }

    /**
     * Take the measurement again for records that entered the order without one.
     *
     * A record's loudness and cue points are copied onto the item when `PickResolver` resolves the
     * pick, and analysis runs on an hourly cron over fifteen tracks at a time — so a record ingested
     * into a long running order is routinely resolved before anything has measured it. It then aired
     * unlevelled and untrimmed for the whole life of that order, however many hours it sat there,
     * because the snapshot was never taken again. Measured on air: two records went out at their raw
     * master level while `deadair.track_analysis` had held a complete measurement of each for
     * twenty minutes.
     *
     * Only the warm window, and for a reason rather than for thrift: a measurement cannot exist
     * before the audio it was taken from, so the records worth asking about are exactly the ones
     * {@link ripenTrackCache} has been fetching. Asking about the whole order would be one large
     * read per pass to re-discover that the far end is still unmeasured.
     *
     * Failures are swallowed on {@link ripenTrackCache}'s terms, and the fallback is the state this
     * replaced rather than anything worse: a record whose measurement could not be read airs the way
     * every record aired before this existed, which is untrimmed and at its own level. **Nothing here
     * may treat an absent measurement as a fault** — that rule is what the whole snapshot design
     * rests on, and this pass narrows how often it is reached instead of changing it.
     */
    private async remeasure(lineup: StationLineup): Promise<void> {
        const items = lineup.all();
        const from = Math.max(0, lineup.committedThrough());
        // The same window the cache planner warms, for the reason above: these are the records whose
        // audio this pass has been getting hold of, so they are the ones that can have been measured.
        const waiting = items
            .slice(from, from + CACHE_AHEAD)
            .filter(isTrackItem)
            .filter(item => item.state === 'planned' && awaitsMeasurement(item.track));
        if (waiting.length === 0) return;

        try {
            const trackIds = [...new Set(waiting.map(item => item.track.trackId!))];
            const found = await inScope(this.container, scope => scope.get(AnalysisRepository).trustedAnalysisFor(trackIds, ANALYSIS_SCHEMA_VERSION));

            let taken = 0;
            for (const item of waiting) {
                const analysis = found.get(item.track.trackId!);
                // Absent is the ordinary answer and says only that nothing has measured this record
                // yet. It is not logged, because on a station with an unmeasured tail that would be
                // a line per record per boundary saying nothing had changed.
                if (analysis === undefined) continue;
                if (lineup.remeasure(item.id, measurementOf(analysis))) taken += 1;
            }

            if (taken === 0) return;
            // One line for the batch rather than one per record, and only when something actually
            // changed: this is the pass telling the operator that records which would have aired raw
            // now will not.
            this.logger.info('director: took the measurement again for records that entered the order without one', { records: taken });
            // Memory is the authority and the row is the record, so the write rides the same throttle
            // every other edit does. Nothing waits on it: what airs is read from the object.
            this.persistSoon();
        } catch (error) {
            this.logger.warn(`director: could not re-read a measurement for the records coming up (${errorText(error)})`);
        }
    }

    /**
     * Say something to a listener who arrived before the station had any music.
     *
     * The audible half of the warm-up. A record is not committed until its bytes are here, so a
     * station given a fresh running order has a full hour planned and cannot play a second of it
     * until the first download lands — and a listener who tunes into that hears silence and has no
     * way to tell it from a station that is broken.
     *
     * Five conditions, each of which is the whole reason for a line of it.
     *
     * **Only while somebody is there.** A segment handed over off air plays out to NOBODY: with
     * `driving` false Liquidsoap's `remainingMs` still falls with the wall clock, which is the
     * measurement `WARM_LEAD = 0` exists for. Planting one on an idle station would spend the
     * holding message on an empty room and then have nothing left to say when a listener arrived.
     *
     * **Only while the wait is HEALTHY.** Bounded by {@link WAITING_ON_AUDIO_MS}, the same threshold
     * the feed reports on, so the holding message covers exactly the stretch that is normal and then
     * gets out of the way. A station whose provider has died should go quiet and let the fault be
     * audible, rather than reassuring a listener every thirty seconds all night that music is coming.
     *
     * **One at a time.** The order is walked for a `warmup` segment that has not been played yet, so
     * the next is planted only once the last has actually aired. That is what makes it a loop rather
     * than a pile, and it needs no memory of its own: the running order IS the memory.
     *
     * **Canned first.** A file in `media/segments/inbox/warmup/` is already `ready` — no model, no
     * speech plugin, no wait — so it airs on this pass. The written floor behind it is a whole
     * write-and-render cycle, which is worth having and is not worth waiting for when the operator
     * has recorded something.
     *
     * **Never fatal.** Swallowed exactly as {@link plantBreaks} is, and more so: this is the one
     * thing in the pass whose entire purpose is to make a failure more bearable, so it must not be
     * able to cause one.
     */
    private async holdWarmUp(lineup: StationLineup, rules: ResolvedRules): Promise<void> {
        // Everything is inside the try, guards included. This is the one step in the pass whose
        // entire purpose is to make a bad moment more bearable, so it must not be able to make one:
        // a throw out of the cheapest-looking condition here would take the commit pass with it and
        // cost the station the very records it is covering for.
        try {
            const since = this.waitingOnAudioSince;
            if (since === undefined || Date.now() - since >= WAITING_ON_AUDIO_MS) return;
            if (!this.audience.gateOpen()) return;
            // Already covered. `planned` is one still to come and `handed`/`airing` is one the
            // listener is hearing now; only once it is behind us is there a gap to fill again.
            if (lineup.all().some(item => item.kind === 'segment' && item.segmentKind === WARMUP_KIND && !isPast(item.state))) return;

            const canned = await inScope(this.container, scope => scope.get(SegmentRepository).listReady(WARMUP_KIND));
            if (canned.length > 0) {
                const chosen = canned[Math.floor(Math.random() * canned.length)]!;
                // At the head of what has not been committed, which is where the gap is. The same
                // row legitimately airs several times over a long wait, exactly as an ident from the
                // shared library does at three slots in an hour.
                const placed = lineup.insertSegments([{ segmentId: chosen.id, atIndex: lineup.committedThrough(), segmentKind: WARMUP_KIND }]);
                if (placed.ok) {
                    this.logger.info('director: holding a listener with a recorded warm-up', { segment: chosen.id });
                    await this.flushPersist();
                }
                return;
            }

            // Nothing recorded, so ask for words. `next` is rendered before it is injected, which is
            // the right half of the seam here for the reason it is right for a welcome: a segment
            // that reaches its slot unready is skipped, and there is no second chance at a listener
            // who has already arrived into silence.
            await this.takeRequest({
                kind: WARMUP_KIND,
                urgency: 'next',
                source: 'audience',
                reason: 'somebody tuned in while the station was still fetching its first records',
                // Keyed and cooled down so a pass every few seconds does not queue a pile of them
                // while the first is still being spoken.
                key: WARMUP_KEY,
                cooldownMs: WARMUP_COOLDOWN_MS,
            });
        } catch (error) {
            this.logger.warn(`director: could not hold a listener while the station warms up (${errorText(error)})`);
        }
    }

    /**
     * Take records the station is not going to be able to play out of the order, while there is
     * still time to replace them.
     *
     * This is the half that turns "silence at the boundary" into "rotation got thinner an hour ago".
     * The same judgement already ran at the commit window — `toPlayerItems` drops a line whose every
     * copy is benched — and running it over the WARM window instead is the whole difference: at the
     * commit window the answer arrives with three items of notice, here it arrives with the whole
     * warm lead, which is long enough for `topUpIfShort` to have asked the generator for more and got
     * an answer.
     *
     * `markUnavailable` rather than `markSkipped`, because those are opposite facts on any page that
     * has to explain a gap: this names a COPY nothing will serve, which is the one an operator can go
     * and do something about. It also splices, reopens any break that promised the line
     * ({@link reopenPromises}), and moves `remaining()`, which is what gets a refill sent.
     */
    private thin(lineup: StationLineup, unfetchable: readonly string[]): void {
        const dropped = unfetchable.filter(itemId => lineup.markUnavailable(itemId));
        if (dropped.length === 0) return;

        for (const itemId of dropped) {
            const item = lineup.find(itemId);
            const title = item !== undefined && isTrackItem(item) ? item.track.title : itemId;

            this.logger.warn('director: dropping a record from the order because its audio will not arrive in time', { item: itemId, title });
            // The station's own summary, never the upstream's text: see `ActivityRecorder`.
            void this.activity.record({
                module: 'director',
                kind: 'item.unavailable',
                severity: 'warn',
                detail: `"${title}" was taken out of the running order before its slot: the station cannot get hold of its audio.`,
                data: { itemId },
            });
        }

        // A refill decision made a moment ago is stale now that the order is shorter, and a break may
        // have promised one of these. Both are exactly what the commit block does for the same marks.
        if (lineup.remaining() >= EXTEND_BELOW) this.extendSentAt = undefined;
        void this.reopenPromises(dropped);
        this.persistSoon();
    }

    /**
     * Put the station's own segments into the order, where the rules say there
     * should be some and there are not.
     *
     * Costs nothing on the overwhelming majority of passes: the planner walks the
     * order in memory and only reaches the database when it has found somewhere to
     * put something, so an order whose breaks are already in place is a loop over
     * an array and no query at all.
     *
     * Failures are swallowed on purpose. A break is the one thing in a commit pass
     * the broadcast does not depend on — the records either side of it play
     * regardless — so a planner that cannot read its library must not be allowed
     * to take down the pass that keeps the running order full.
     */
    private async plantBreaks(lineup: StationLineup, rules: ResolvedRules): Promise<void> {
        try {
            await inScope(this.container, async scope => {
                const planner = scope.get(BreakPlanner);

                // One reading for both walks rather than one each. Planting writes to the database,
                // so a second reading taken after it can find a different item on air — and these
                // two are the projection that decides where a break GOES and the projection that
                // decides what it SAYS. Anchored to different instants they disagree about the same
                // boundary, which is the shape of bug `break.claims.ts` keeps one predicate to
                // avoid. Planting cannot invalidate this one: it inserts only ahead of the cursor,
                // and the anchor is the index of the item already airing.
                const clock = this.airClock(lineup);

                const planted = await planner.plant(lineup, rules, clock);

                // Written THROUGH rather than soon, and only on a pass that planted something.
                // What is about to be asked for is the words of breaks in this order, and the job
                // that writes them reads the order from the row: with the ordinary throttle it can
                // pick up a break the row does not hold yet, find no neighbours, and write a break
                // about nothing. The job guards against that itself and defers, so this is the
                // difference between the ordinary case working and the ordinary case needing a
                // retry — and a planting pass is rare, so the cost is a write nobody is waiting on.
                if (planted > 0) await this.flushPersist();

                // Second, and on every pass rather than only one that planted something. Planting
                // lays a break's POSITION down as far ahead as the order runs; this asks for its
                // WORDS only once its slot is near, which is what keeps an hour of forward planning
                // from costing an hour of model and speech work that an operator edit can throw
                // away. It touches no running order, so it needs no persist of its own.
                //
                // It also repairs what it finds. The feed line is written from here rather than
                // from the planner, because the planner has no recorder and because this is where
                // the other producer of the same event already lives.
                const ripened = await planner.ripen(lineup, clock);
                if (ripened.rewritten.length > 0) {
                    // General on purpose, where `segment_events.reason` is exact. One pass can
                    // reopen breaks for two different faults — the order moved under one and the
                    // clock past another — so a feed line naming a cause would be wrong for half
                    // the batch. It said "about the running order" for every fault until 30 August
                    // and that is precisely what it got wrong. `reasonFor` writes the specific
                    // sentence onto each row, which is where somebody asking about ONE break looks.
                    this.reportRewriting(ripened.rewritten, {
                        one: 'no longer said anything true',
                        many: 'no longer said anything true',
                    });
                }
                if (ripened.rerendered.length > 0) {
                    // Not a fault: the words are intact and the engine may well answer this time.
                    // Worth a line at all because it is the only place a listener's silent boundary
                    // is connected to the speech server that was down when it was written.
                    void this.activity.record({
                        module: 'director',
                        kind: 'break.rerendering',
                        detail:
                            ripened.rerendered.length === 1
                                ? 'A break that never got its audio is being spoken again.'
                                : `${ripened.rerendered.length} breaks that never got their audio are being spoken again.`,
                        data: { segmentIds: ripened.rerendered },
                    });
                }
                if (ripened.released.length > 0) {
                    // Its own kind rather than a rewrite: this is the station noticing that a job
                    // died holding a break, which is a fault an operator never saw happen and the
                    // only place it is ever reported.
                    void this.activity.record({
                        module: 'director',
                        kind: 'break.released',
                        severity: 'fault',
                        detail:
                            ripened.released.length === 1
                                ? 'A break was left half-finished by a job that never came back, and has been picked up again.'
                                : `${ripened.released.length} breaks were left half-finished by jobs that never came back, and have been picked up again.`,
                        data: { segmentIds: ripened.released },
                    });
                }
            });
        } catch (error) {
            this.logger.warn(`director: could not plan breaks for the running order (${errorText(error)})`);
        }
    }

    /**
     * Where the station is against the wall clock, for anything scheduled against a time.
     *
     * Anchored to the item ON AIR and its own start, rather than to the first planned one: the
     * player is holding several items already, and their lengths are in the order, so projecting
     * from the airing item's start is the only anchor that accounts for what has been handed over
     * but not yet heard. Anchoring at the cursor instead would put every boundary two or three
     * records early.
     *
     * Deliberately NOT built from `nowPlaying().remainingMs`. That reading comes from the decoder,
     * `rundown.ts` says plainly that nothing schedules against it, and this is not the exception
     * that proves it: a jumpy reading would shift every boundary behind it, whereas `startedAt` is
     * observed once and never moves.
     *
     * Falls back to now at the cursor, which is what a station that has just gone on air looks
     * like. That is honest rather than defensive: nothing is airing, so nothing is late.
     */
    private airClock(lineup: StationLineup): AirClock {
        const now = Date.now();
        const playing = this.rundown.nowPlaying();

        if (playing !== undefined) {
            const from = lineup.all().findIndex(item => item.id === playing.item.id);
            if (from >= 0) return { now, anchorAt: playing.startedAt, from };
        }

        return { now, anchorAt: now, from: lineup.committedThrough() };
    }

    /**
     * Turn the items just taken from the order into the form the player can be
     * handed, and say which of them the station will pass over.
     *
     * A record passes straight through: the order already holds everything the
     * player needs. A segment is a reference, so its row is read here — and a
     * segment that is not `ready` is **skipped**, not waited for.
     *
     * That rule is the whole reason the running order can hold something the
     * station has not finished making. A director that held the slot open would
     * hand the listener silence for as long as a renderer took, and a renderer
     * that failed would hold it open forever. Skipping costs an ident nobody
     * hears; stalling costs the broadcast.
     *
     * One read for the whole batch rather than one per item, because a commit
     * pass runs on every track boundary and the lead is only three items.
     */
    private async toPlayerItems(items: readonly StationLineupItem[]): Promise<{ items: RundownItem[]; skipped: string[]; unavailable: string[] }> {
        const wanted = items.filter(item => item.kind === 'segment').map(item => item.segmentId);
        const segments =
            wanted.length === 0
                ? new Map<string, Segment>()
                : await inScope(this.container, async scope => scope.get(SegmentRepository).findByIds(wanted));

        // Which of these records the station can still get hold of, asked ONCE for the batch.
        //
        // Read here rather than left to the hand-over because the answer changes underneath a
        // running order: a copy that fails to serve four times is benched by `TrackAudioService`,
        // every reader excludes on `missing_at` from that moment, and the line sits in the order
        // looking perfectly fine until the transport reaches it and cannot resolve a URL. That is
        // several minutes during which the station is still planning around a record it can no
        // longer play — and, worse, still allowed to promise it in a talk break.
        //
        // Only a record the CATALOG holds can be judged: a pick straight from a provider playlist
        // has no `trackId` and no binding row to be missing, so it is left alone and answers for
        // itself at hand-over.
        //
        // Deliberately NOT passed the station's advisory policy, which is not an oversight. This
        // asks whether a record is still AVAILABLE; the policy is about which copy to PROGRAMME,
        // and it was applied when `PickResolver` chose this item. Handing it in here would mean an
        // operator switching to clean-only mid-broadcast marks everything already in the running
        // order `unavailable` and splices it out, which is the wrong word for it and the wrong
        // moment. The policy takes effect on the next refill, exactly as a rating change does.
        const catalogued = items.flatMap(item => (item.kind === 'track' && item.track.trackId !== undefined ? [item.track.trackId] : []));
        const bindings =
            catalogued.length === 0
                ? new Set<string>()
                : new Set((await inScope(this.container, async scope => scope.get(CandidatesRepository).bindingsFor(catalogued))).keys());

        const playable: RundownItem[] = [];
        const skipped: string[] = [];
        const unavailable: string[] = [];
        // A talk-over waiting for a record to attach itself to. It may have arrived in an earlier
        // batch: see the field's own note.
        let pending = this.pendingVoice;
        this.pendingVoice = undefined;

        for (const item of items) {
            if (item.kind === 'track') {
                // Nothing the station can play, and known before the slot rather than at it. The
                // line comes out of the running order now, which is what gives a break promising
                // it time to be rewritten — and, failing that, what makes the claim check at
                // hand-over drop the break rather than air a promise about a record nobody will
                // hear. See `nextTrackAfter`, which passes over an unavailable line.
                if (item.track.trackId !== undefined && !bindings.has(item.track.trackId)) {
                    this.logger.info('director: taking a record out of the order because no copy of it will serve', {
                        item: item.id,
                        track: item.track.trackId,
                        title: item.track.title,
                    });
                    void this.activity.record({
                        module: 'director',
                        kind: 'item.unavailable',
                        severity: 'fault',
                        detail: `"${item.track.title}" was taken out of the running order: every copy of it has been benched.`,
                        data: { itemId: item.id, trackId: item.track.trackId },
                    });
                    unavailable.push(item.id);
                    continue;
                }

                // The order's own id, carried through unchanged. It rides the annotation into
                // Liquidsoap and comes back on its readings, which is what lets a restarted
                // process name the record a listener is in the middle of.
                playable.push({
                    ...item.track,
                    id: item.id,
                    ...(pending === undefined
                        ? {}
                        : {
                              voice: {
                                  segmentId: pending.segmentId,
                                  atMs: pending.atMs,
                                  itemId: pending.itemId,
                                  ...(pending.loudnessLufs === undefined ? {} : { loudnessLufs: pending.loudnessLufs }),
                              },
                          }),
                });
                pending = undefined;
                continue;
            }

            const segment = segments.get(item.segmentId);
            if (segment?.state !== 'ready') {
                this.logger.info('director: skipping a segment that is not ready to air', {
                    segment: item.segmentId,
                    // `gone` rather than a state, for a row the order names and the library no
                    // longer holds. Distinguishable in a log, and the same outcome either way.
                    state: segment?.state ?? 'gone',
                });
                // The station reaching a break and passing over it. `segment_events` says the
                // segment failed to render, which is a different fact and often minutes earlier;
                // this is the moment it cost the broadcast something. Not a fault: skipping rather
                // than waiting is exactly what keeps a broken renderer from silencing the station.
                void this.activity.record({
                    module: 'director',
                    kind: 'item.skipped',
                    detail: `A break was passed over at its slot because it is ${segment?.state ?? 'no longer in the library'}.`,
                    data: { segmentId: item.segmentId, state: segment?.state ?? 'gone' },
                });
                skipped.push(item.id);
                continue;
            }

            // The other end of the forward claim, in both dimensions. A break saying "coming up, X"
            // or "it's just after nine" named something when it was written, minutes ago, and the
            // words are now baked into audio that cannot be re-cut. Everything that can happen to a
            // running order and to the clock in that gap makes them false. The station would then
            // name a record that is not the one playing, in a confident voice, which is the kind of
            // error a listener remembers.
            //
            // So it is checked here, against the order as it stands at the instant of hand-over, and
            // a claim that no longer holds costs the break. Silence on one boundary beats a wrong
            // fact — the same trade the station already makes by skipping a segment that is not
            // ready, taken through the same branch, so the order does not lose its lead either.
            //
            // The question itself lives in `break.claims.ts`, because `BreakPlanner.ripen` asks the
            // same one earlier, where the answer is worth a rewrite rather than a dropped break.
            // Two readings of one claim that could disagree would be two bugs waiting.
            // The projection, measured against the moment it was projecting.
            //
            // `air.clock.ts` guarantees a LOWER bound — everything it cannot measure counts as zero,
            // so a break is meant to land at or AFTER its `airs_at` — and the whole time claim rests
            // on that being true, because a break landing early names a time that has not come
            // round. Nothing ever checked it. When it stopped holding, what the station saw was
            // breaks being dropped one after another with no number anywhere saying by how much or
            // in which direction, and the answer had to be reconstructed from `claims_time_from`
            // against `updated_at` on the rows afterwards.
            //
            // So the drift is recorded for EVERY break that reaches a slot rather than only for the
            // ones a claim then costs: a station whose breaks all air is still one whose projection
            // may be seconds from the edge, and that is worth seeing before it becomes the other
            // thing. Positive is late, which is the direction the projection promises; negative is
            // early, which is the one it says it never takes.
            const airedAt = Date.now();
            const projectedAt = segment.airsAt;
            const driftMs = projectedAt === undefined ? undefined : airedAt - projectedAt;
            if (projectedAt !== undefined && driftMs !== undefined) {
                this.logger.debug('director: a break reached its slot against the time the order projected for it', {
                    segment: item.segmentId,
                    projected: new Date(projectedAt).toISOString(),
                    driftMs,
                    when: driftMs < 0 ? 'early' : 'late',
                });
            }

            const broken = brokenClaim(
                segment,
                { previous: this.lineup?.previousTrackBefore(item.id)?.id, next: this.lineup?.nextTrackAfter(item.id)?.id },
                airedAt,
            );
            if (broken?.kind === 'item') {
                this.logger.info('director: dropping a break whose running order has moved under it', {
                    segment: item.segmentId,
                    claimed: broken.claimed,
                    next: broken.next ?? 'nothing',
                });
                // Worth its own kind rather than folding into `item.skipped`: an operator who
                // shuffled the order and then noticed the station stopped talking is looking at the
                // consequence of their own edit, and "the break named a record that no longer plays
                // next" is the only sentence that says so.
                void this.activity.record({
                    module: 'director',
                    kind: 'break.claimStale',
                    detail: 'A break was dropped because the record it named is no longer what plays next.',
                    data: { segmentId: item.segmentId, claimed: broken.claimed, next: broken.next ?? 'nothing' },
                });
                skipped.push(item.id);
                continue;
            }

            if (broken?.kind === 'previous') {
                this.logger.info('director: dropping a break whose back-announce is not what played', {
                    segment: item.segmentId,
                    claimed: broken.claimed,
                    previous: broken.previous ?? 'nothing',
                });
                // The backward twin of `break.claimStale` above: the record is still going out, and
                // what moved is which one the running order actually played in that slot.
                void this.activity.record({
                    module: 'director',
                    kind: 'break.claimStale',
                    detail: 'A break was dropped because the record it back-announced is not the one that played.',
                    data: { segmentId: item.segmentId, claimed: broken.claimed, previous: broken.previous ?? 'nothing' },
                });
                skipped.push(item.id);
                continue;
            }

            if (broken?.kind === 'time') {
                // Both directions are equally fatal here and only the sentence differs: a break
                // reaching its slot EARLY names a time that has not come round, which is as wrong
                // to a listener as one that has been overtaken. The rewrite treats the two
                // differently and this deliberately does not — see `break.claims.ts`.
                this.logger.info('director: dropping a break whose words are no longer true of the time', {
                    segment: item.segmentId,
                    when: broken.when,
                    from: new Date(broken.from).toISOString(),
                    until: new Date(broken.until).toISOString(),
                    // Carried onto the drop as well as logged above it, because this is the line an
                    // operator reads when the station stops talking and the drift is the number that
                    // says whether the words or the projection are at fault.
                    ...(driftMs === undefined ? {} : { driftMs }),
                });
                void this.activity.record({
                    module: 'director',
                    kind: 'break.claimStale',
                    detail:
                        broken.when === 'late'
                            ? 'A break was dropped because the time it named has passed.'
                            : 'A break was dropped because it reached its slot before the time it named came round.',
                    data: {
                        segmentId: item.segmentId,
                        when: broken.when,
                        from: broken.from,
                        until: broken.until,
                        ...(driftMs === undefined ? {} : { driftMs }),
                    },
                });
                skipped.push(item.id);
                continue;
            }

            if (broken?.kind === 'reading') {
                // The third dimension, and the only one where nothing in this station did anything
                // wrong: the words named no record and no time, they REPORTED something, and the
                // world moved. `BreakPlanner.ripen` would have rewritten this if the slot had come
                // round later; reaching here means it did not, and a station stating this morning's
                // weather at teatime is the kind of error a listener remembers.
                this.logger.info('director: dropping a break whose reading is too old to still be true', {
                    segment: item.segmentId,
                    until: new Date(broken.until).toISOString(),
                });
                void this.activity.record({
                    module: 'director',
                    kind: 'break.claimStale',
                    detail: 'A break was dropped because what it reported is no longer current.',
                    data: { segmentId: item.segmentId, until: broken.until },
                });
                skipped.push(item.id);
                continue;
            }

            // A talk-over is not an item the player is handed and never becomes one: it is heard
            // ALONGSIDE the record that follows it rather than in the gap before it, so it rides
            // on that record and the pusher arms it as the record is handed over.
            //
            // Two of them in a row would be one talking over the other, so the later one wins and
            // the earlier is dropped. That is a programming mistake rather than a fault, and the
            // alternative — queueing them — is two voices at once.
            if (item.over !== undefined) {
                if (pending !== undefined) {
                    this.logger.info('director: two talk-overs in a row; keeping the later one', { dropped: pending.segmentId });
                    skipped.push(pending.itemId);
                }
                // Marked handed HERE rather than when it finds its record, and the difference is
                // a loop rather than a nicety: a cue left `planned` is the first thing the next
                // pass offers, so it would be picked up again, hold itself for the record after,
                // and never let the running order move past it. It is the one thing this class
                // still hands over itself, because a cue is never given to the player in its own
                // right and so the transport never reaches it.
                this.lineup?.markHanded(item.id);
                // Carried from the row here rather than looked up at hand-over: this is the only
                // place a talk-over's segment is read at all, since it never becomes a player item.
                pending = {
                    itemId: item.id,
                    segmentId: segment.id,
                    atMs: item.over.atMs,
                    ...(segment.loudnessLufs === undefined ? {} : { loudnessLufs: segment.loudnessLufs }),
                };
                continue;
            }

            playable.push({ ...segmentRundownTrack(segment), id: item.id });
        }

        // Held for the next pass rather than dropped. A batch is only three items, so a talk-over
        // planted before the last record of one lands here roughly a third of the time, and
        // discarding it would silently lose that many breaks. It is cleared wherever the plan
        // changes, alongside the epoch it would otherwise outlive.
        this.pendingVoice = pending;
        return { items: playable, skipped, unavailable };
    }

    /**
     * Give a break whose promise just broke a chance to say something true instead.
     *
     * The words of "coming up, X" are baked into audio that cannot be re-cut, so a break naming a
     * record that has just been taken out of the order has exactly two futures: it is dropped at
     * hand-over by the claim check, or it is written again before its slot arrives. This asks for
     * the second, and the first is what happens if it does not land in time — no deadline, no
     * timer, and no new rule, because a segment that is not `ready` when its turn comes is already
     * skipped rather than waited for.
     *
     * Best-effort throughout, and the `catch` is the point: the break is no worse off than it was
     * a moment ago, so a failure here must never cost the pass that was taking a dead record out of
     * the running order.
     */
    private async reopenPromises(itemIds: readonly string[]): Promise<void> {
        if (itemIds.length === 0) return;

        try {
            const reopened = await inScope(this.container, async scope => scope.get(SegmentRepository).reopenClaims(itemIds));
            if (reopened.length === 0) return;

            this.logger.info('director: a break promised a record that will not air, so it will be written again', {
                segments: reopened,
            });
            this.reportRewriting(reopened, { one: 'promised a record that will not air', many: 'promised records that will not air' });
        } catch (error) {
            this.logger.warn(`director: could not re-offer a break whose promise broke (${errorText(error)})`);
        }
    }

    /**
     * Tell the operator that a break is being written a second time, and why.
     *
     * Two things reopen a break now — a record leaving the order, and the window pass finding words
     * that have stopped being true — and they are the same event with a different cause, so the
     * sentence is built in one place. It is worth a line at all because a rewrite is usually the
     * consequence of an edit somebody made a moment ago, and the alternative reading of the same
     * moment is a station that has gone quiet for no reason.
     */
    private reportRewriting(segmentIds: readonly string[], because: { one: string; many: string }): void {
        void this.activity.record({
            module: 'director',
            kind: 'break.rewriting',
            detail:
                segmentIds.length === 1
                    ? `A break ${because.one}, so it is being written again.`
                    : `${segmentIds.length} breaks ${because.many}, so they are being written again.`,
            data: { segmentIds: [...segmentIds] },
        });
    }

    /** Prepare these items and mark whatever the station will pass over. */
    private async prepareForPlayer(items: readonly StationLineupItem[]): Promise<void> {
        const prepared = await this.toPlayerItems(items);
        this.rundown.prepare(prepared.items);
        for (const itemId of prepared.skipped) this.lineup?.markSkipped(itemId);
        for (const itemId of prepared.unavailable) this.lineup?.markUnavailable(itemId);
    }

    /**
     * Send a refill when the tail is getting short.
     *
     * Guarded, because a burst of rundown events would otherwise queue a dozen
     * identical jobs for one shortfall. The guard clears early when the order has
     * actually grown, and otherwise EXPIRES — the order growing is evidence the
     * last refill landed, but its absence is not evidence one is still coming.
     * See {@link EXTEND_GUARD_MS} for the five ways a refill finishes without
     * adding anything, every one of which used to stop the station for good.
     */
    private async topUpIfShort(lineup: StationLineup, rules: ResolvedRules): Promise<void> {
        if (lineup.onEnd !== 'extend' || !rules.mayGenerate || lineup.remaining() >= EXTEND_BELOW) {
            this.extendSentAt = undefined;
            return;
        }
        if (this.extendSentAt !== undefined && Date.now() - this.extendSentAt < EXTEND_GUARD_MS) return;

        // The guard is set only once the send has actually landed, so a send that threw is asked
        // again on the very next boundary rather than waiting out the window. That is now belt and
        // braces — the window expires either way — but it is the difference between the next
        // boundary and five minutes of a shortening order, and it costs one line.
        try {
            await this.jobs.send('director.extend_lineup', {});
        } catch (error) {
            // Swallowed on purpose, and the guard is left clear so the next boundary asks again.
            // A refill that could not be sent must not take the commit pass down with it: the
            // order still has items, the station is still playing them, and the pass this is the
            // tail of is what keeps the running order full.
            this.logger.warn(`director: could not ask for a refill (${errorText(error)})`);
            return;
        }
        this.extendSentAt = Date.now();

        this.logger.info('director: the running order is running short; a refill is on its way', { remaining: lineup.remaining() });
    }

    /**
     * The running order has reached its end. What happens next is the operator's
     * decision, recorded on the order itself.
     *
     * Nothing here cuts the listener off: the items already committed keep
     * playing, and this only decides what is committed after them.
     *
     * None of these branches commits anything itself. They rearrange what is on
     * air and then return, because this runs INSIDE a commit pass. The next pass is
     * at most a couple of seconds away — the pusher's reconcile produces one whether
     * or not the running order changed — and there is a track playing throughout.
     */
    private async finish(lineup: StationLineup, rules: ResolvedRules): Promise<void> {
        switch (lineup.onEnd) {
            case 'repeat':
                // Every item that has been heard or passed over is offered again, which is what
                // wrapping IS now: a state put back rather than a position moved to zero.
                lineup.resetPlayed();
                await this.persist();
                return;

            case 'extend':
                // The refill has either landed (and this is not exhausted after all) or
                // is still in flight. Either way the guard below is the whole handling:
                // it will be sent once, and the next boundary picks up what arrives.
                await this.topUpIfShort(lineup, rules);
                return;

            case 'stop':
            default:
                this.logger.info('director: the running order ended and says to stop; standing down');
                // Goes through the rundown so the mount is handed back the same way the
                // operator's own Stop does, and so this class hears its own stand-down.
                this.rundown.reset();
                return;
        }
    }

    /**
     * Write what actually aired.
     *
     * Hung off the rundown's own confirmation rather than off the commit above,
     * because those are a lead apart: the item being committed now is three
     * tracks from being heard, and history that recorded it would suppress a song
     * before anybody had played it.
     */
    private remember(item: RundownItem, passedOver: number): void {
        // ONE event for the whole catch-up, not one per item, and that is the difference between a
        // line worth reading and twenty that bury the rest of the feed. The count is the fact: the
        // player moved past everything committed behind it, and whether that was a failed decode,
        // an operator's skip or a stream that dropped, the station lost that programming and
        // nothing else says so. The per-item branch in `toPlayerItems` covers a DIFFERENT case — a
        // break that was not ready when its slot came round — and was the only one covered until a
        // run against the real station wrote off twenty items in silence.
        //
        // `warn` rather than `fault`: the station kept broadcasting and a listener heard the next
        // record, which is not the same as the mount going quiet.
        if (passedOver > 0) {
            void this.activity.record({
                module: 'director',
                kind: 'order.caughtUp',
                severity: 'warn',
                detail: `The player moved on to ${item.title}, so ${passedOver === 1 ? 'one item that had been handed over' : `${passedOver} items that had been handed over`} never aired.`,
                data: { passedOver, itemId: item.id },
            });
        }

        // The item's own state has already moved: the rundown marks it airing at the moment the
        // player says so, on the one shared order. This listener is only for what has to be
        // written DOWN about it.
        //
        // Play history exists to steer what the station plays NEXT: the repeat window and the
        // artist cooldown are both reads of it. A segment is not a record and has no artist, so a
        // row for it would put "Station ident" into the song key space and have the station
        // suppress its own idents for a fortnight.
        if (isRenderItem(item)) return;

        const source = this.lineup?.source ?? 'director';
        // Off the running order rather than the shared holder, because this one CAN say which
        // broadcast without asking: the record that just aired came out of this order.
        const broadcastId = this.lineup?.broadcastId;

        void inScope(this.container, async scope =>
            scope.get(PlayHistoryRepository).record({
                item,
                source,
                stationKey: this.identity.stationKey,
                ...(broadcastId === undefined ? {} : { broadcastId }),
            }),
        ).catch(error =>
            // One lost row costs a little accuracy in the repeat window. Nothing about
            // the broadcast depends on it, and the boundary must not be held up.
            this.logger.warn(`director: could not record what aired (${errorText(error)})`),
        );

        // The same edge, the same posture, and deliberately a separate call rather than a step
        // inside the write above: the history row steers what the station plays next and this
        // tells somebody else's service what it played, so one failing must not cost the other.
        // Both are `void`ed because a track boundary is not a place to wait for a database.
        void inScope(this.container, async scope => {
            const scrobble = scope.get(ScrobbleService);
            const play: ScrobblePlay = {
                title: item.title,
                // The LEAD artist, which is what a scrobbling service matches on. The whole credit
                // line is in `play_history.artists` for a human to read and is the wrong thing to
                // send — and reading it out of `artists[0]` was sending exactly that, since a
                // resolved item carries its credit there as a single element.
                artist: item.artist,
                ...(item.album === undefined ? {} : { album: item.album }),
                ...(item.durationMs === undefined ? {} : { durationMs: item.durationMs }),
                playedAt: Date.now(),
            };
            if (play.artist.length === 0) return;

            // Announced before it is queued, because one is about now and the other is about
            // later: a now-playing sent after a database round trip is already stale.
            void scrobble.announceNowPlaying(play);
            await scrobble.enqueue({
                play,
                stationKey: this.identity.stationKey,
                ...(broadcastId === undefined ? {} : { broadcastId }),
            });
        }).catch(error => this.logger.warn(`director: could not queue what aired for scrobbling (${errorText(error)})`));
    }

    /**
     * Stop driving, NOW, in the caller's own stack frame.
     *
     * Split from {@link standDown} because stopping and recording that you stopped want different
     * timing, and the split is load-bearing rather than tidy. A stand-down has to cancel a commit
     * pass that is already in flight, and **the mailbox cannot do that**: a queued command runs
     * after that pass, by which time it has appended and the station is back on air with three
     * records nobody asked for. Serializing decisions stops them interleaving; it does not
     * un-decide one that was already made, which is what the epoch is for.
     *
     * So the cancellation is synchronous and the durable write is queued behind it.
     */
    private beginStandDown(): void {
        // The transition, caught at the only moment it is visible. `active` is false a line below
        // and the durable half runs behind the mailbox, by which time nothing on this object still
        // says the station was on air — so a feed reading it there would report a stop every time
        // anything asked a stopped station to stop. `||=` rather than `=` because several of these
        // can land before one durable write drains, and the first one is the edge.
        this.standDownFromActive ||= this.active;
        this.epoch.bump();
        this.pendingVoice = undefined;
        this.active = false;
        this.extendSentAt = undefined;
        this.airReadAt = 0;
        this.standingDown = true;
        // Nothing written from here on belongs to a broadcast, because there is not one on.
        // Deliberately not left set for the stand-down's own activity row: an operator stopping
        // the station is a fact about the station, not part of the programme they stopped.
        this.identity.ended();
    }

    /**
     * Put the station back on air with the running order it already has.
     *
     * The counterpart to {@link standDown}, and the thing that was missing beside it: standing down
     * deliberately LEAVES the running order in `station_lineup`, every item still saying where it got
     * to, and until now the only way back on air was `putOnAir`, which throws all of that away and
     * builds a new broadcast from a playlist read at that moment.
     *
     * The same broadcast, therefore, and not a new one: `restore` reads the id back off the row, so
     * the hour either side of an operator's Stop is one programme rather than two.
     *
     * Refuses cleanly when there is nothing to resume, rather than switching the station on and
     * leaving it holding nothing: an empty station that says it is on air is the state the whole
     * `hasProgramme` lease exists to avoid describing.
     */
    private async resume(): Promise<ResumeResult> {
        // Cleared FIRST. `standDown` sets it to keep this process off air until the row is written,
        // and a resume arriving while it is still set would be dropped by the commit pass it ends in.
        this.standingDown = false;

        await inScope(this.container, async scope => scope.get(StationAirRepository).goOnAir());
        this.airReadAt = 0;
        await this.restore();

        if (!this.lineup || this.lineup.remaining() === 0) {
            this.logger.info('director: nothing to resume; the station has no running order left to play');
            return { resumed: false };
        }

        this.logger.info('director: resumed the running order the station was stopped on', { remaining: this.lineup.remaining() });
        void this.activity.record({
            module: 'director',
            kind: 'air.on',
            detail: 'The station was started again on the running order it had been stopped on.',
            data: { remaining: this.lineup.remaining() },
        });

        return { resumed: true };
    }

    /** Remember that the station is off, so a restart stays off. */
    private async standDown(): Promise<void> {
        // Idempotent, and called directly by the `standDown` command as well as after
        // {@link beginStandDown}. A stand-down reached any other way still has to cancel.
        this.beginStandDown();

        try {
            await inScope(this.container, async scope => scope.get(StationAirRepository).standDown());
            // What the player was holding was retracted with it, and the states saying so are
            // worth keeping: they are what a console draws as the running order this station
            // stopped part-way through.
            await this.persist();
        } catch (error) {
            // The intent stands even if the write did not. Leaving `standingDown` set
            // keeps this process off air, which is the safe half of the failure: the
            // alternative is a station that resumes because its own note did not save.
            this.logger.warn(`director: could not record the stand-down (${errorText(error)})`);
            return;
        }
        this.standingDown = false;

        // After the durable write rather than beside the intent: a stand-down whose row did not
        // save returns above with the flag still set, so the attempt that lands is the one that
        // says so. A feed reporting a stop the station does not know about is worse than a feed
        // missing a line.
        const wasActive = this.standDownFromActive;
        this.standDownFromActive = false;
        if (wasActive) {
            // Both media, like every other station-level edge: the log line is what is still
            // greppable when the database is the thing that is broken, and it is the only record
            // at all once the feed has been swept. `putOnAir` says the same thing the same way.
            this.logger.info('director: stood the station down');
            void this.activity.record({
                module: 'director',
                kind: 'air.off',
                detail: 'The station was stood down, so it is holding nothing and airing nothing.',
            });
        }
    }

    /**
     * Ask for the running order to be written down within {@link PERSIST_THROTTLE_MS}.
     *
     * For everything nobody is waiting on. Returns early when a write is already
     * owed rather than restarting the timer, which is what makes this a throttle:
     * a debounce reset by every transition would put off the write for as long as
     * the station kept moving.
     */
    private persistSoon(): void {
        if (this.persistTimer) return;

        this.persistTimer = setTimeout(() => {
            this.persistTimer = undefined;
            // Swallowed: the authority is memory, and a write that failed is retried by the next
            // transition. A boundary must not be held up by the record of it.
            void this.persist().catch(error => this.logger.warn(`director: could not write the running order down (${errorText(error)})`));
        }, PERSIST_THROTTLE_MS);
        this.persistTimer.unref?.();
    }

    /** Write now if the throttle owes anything, and forget the timer. */
    private async flushPersist(): Promise<void> {
        if (!this.persistTimer) return;

        clearTimeout(this.persistTimer);
        this.persistTimer = undefined;
        await this.persist().catch(error => this.logger.warn(`director: could not write the running order down (${errorText(error)})`));
    }

    /**
     * Write the running order down, now.
     *
     * Memory is the authority and this is the record. The station does not need
     * Postgres up to advance a track, which is why nothing here is on the path
     * between a boundary and the next item going to the player.
     *
     * Called directly only where somebody is waiting for the answer: an operator's
     * edit, and going on air. Everything else goes through {@link persistSoon}.
     */
    private async persist(): Promise<void> {
        const lineup = this.lineup;
        if (!lineup) return;

        // A write that lands makes the timer's pending one redundant.
        if (this.persistTimer) {
            clearTimeout(this.persistTimer);
            this.persistTimer = undefined;
        }
        lineup.trimPast();
        await inScope(this.container, async scope => scope.get(StationLineupRepository).save(lineup.toSnapshot()));
    }

    /**
     * The current `station_air`, re-read at most every {@link AIR_TTL_MS} while the
     * station is on air.
     *
     * The throttle does not apply while it is NOT. An idle director has nothing
     * else to do, one small query every couple of seconds costs nothing, and being
     * switched on is the one change it should notice immediately rather than up to
     * a TTL later. The throttle exists for the busy case, where this runs several
     * times per track.
     */
    private async readAir(force = false): Promise<StationAir | undefined> {
        if (!force && this.active && Date.now() - this.airReadAt < AIR_TTL_MS) return this.air;

        this.air = await inScope(this.container, async scope => scope.get(StationAirRepository).get(MAIN_SLOT));
        this.airReadAt = Date.now();
        return this.air;
    }
}

/**
 * Which arm of {@link DirectorCommandResult} came back.
 *
 * The mailbox answers one union for every command, so a caller that knows which command it posted
 * still has to narrow. Two guards rather than a cast, because a cast would go on compiling on the
 * day a third command grows an answer.
 */
const isEditResult = (result: DirectorCommandResult): result is EditResult => result !== undefined && 'ok' in result;

const isResumeResult = (result: DirectorCommandResult): result is ResumeResult => result !== undefined && 'resumed' in result;

const isBreakRequestResult = (result: DirectorCommandResult): result is BreakRequestResult => result !== undefined && 'accepted' in result;

/**
 * The head of a candidate list holding `wanted` RECORDS, plus any segments in front of them.
 *
 * The window is a promise about how much music is committed, and segments ride along for free
 * because they may produce no player item at all. See {@link SEGMENT_SLACK}.
 */
function takeForLead(candidates: readonly StationLineupItem[], wanted: number): StationLineupItem[] {
    const taken: StationLineupItem[] = [];
    let records = 0;

    for (const item of candidates) {
        if (isTrackItem(item)) {
            if (records === wanted) break;
            records += 1;
        }
        taken.push(item);
    }

    return taken;
}
