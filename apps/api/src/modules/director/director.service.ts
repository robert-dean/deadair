import { Container, Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { AIR_MODE_KEY, parseAirMode, type AirMode } from '#modules/playout/air.mode.js';
import { AudienceWatch } from '#modules/playout/audience.watch.js';
import { TrackCachePlanner } from '#modules/playout/audio/track.cache.planner.js';
import { Epoch } from '#modules/shared/epoch.js';
import { Rundown, type RundownItem, type RundownTrack } from '#modules/playout/rundown.js';
import { SegmentRepository, type Segment } from '#modules/render/segment.repository.js';
import { isRenderItem, segmentRundownTrack } from '#modules/render/segment.source.js';
import { BreakPlanner } from './break.planner.js';
import { DirectorMailbox, type DirectorCommand, type DirectorCommandResult, type OrderEdit } from './director.mailbox.js';
import { PlayHistoryRepository } from './play.history.repository.js';
import { resolveRules, stationRules, type ResolvedRules } from './rotation.rules.js';
import { MAIN_SLOT, StationAirRepository, type StationAir } from './station.air.repository.js';
import { StationLineup, type EditResult, type StationLineupBinding, type StationLineupItem, type StationLineupSnapshot } from './station.lineup.js';
import { StationLineupRepository } from './station.lineup.repository.js';

/**
 * How many items to keep in the running order beyond what is airing.
 *
 * Small on purpose. Committing further ahead buys nothing and costs everything an
 * operator edit could have changed: an item handed to the player is one they can
 * no longer reorder or remove. Two or three is enough for the pusher to keep the
 * player's own lead full.
 */
const COMMIT_LEAD = 3;

/**
 * Commit the tail below this and a refill is sent.
 *
 * Comfortably more than {@link COMMIT_LEAD}, so the job has a dozen tracks of
 * airtime to finish in rather than racing the boundary. A station that waited
 * until it was empty would be asking a rate-limited walk to produce audio in the
 * next four minutes.
 */
const EXTEND_BELOW = 8;

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
    /** A refill is already queued. Cleared once the order has actually grown. */
    private extendSent = false;
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
    private pendingVoice?: { itemId: string; segmentId: string; atMs: number };
    private readonly unsubscribes: (() => void)[] = [];
    /** A write the throttle owes. Set while a timer is pending; see {@link persistSoon}. */
    private persistTimer?: NodeJS.Timeout;

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
        this.unsubscribes.push(this.rundown.onAired(item => this.remember(item)));
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
    status(): { active: boolean; airMode: AirMode; name?: string; source?: string; remaining: number } {
        return {
            active: this.active,
            airMode: this.airMode,
            ...(this.lineup === undefined ? {} : { name: this.lineup.name, source: this.lineup.source }),
            remaining: this.lineup?.remaining() ?? 0,
        };
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
        // The edit arm always answers. The type is wide because most commands have
        // nothing to say, not because this one might stay silent.
        return result ?? { ok: false, reason: 'not-found', message: 'the station has nothing on air to edit' };
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

        this.lineup = await this.inScope(async scope => scope.get(StationLineupRepository).load());
        if (!this.lineup) return;

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
     * Post a command with nobody to hand a failure to.
     *
     * What every listener uses. They run on the pusher's loop or on a track boundary, so there is
     * no caller to reject to and an uncaught one would take the process down for something the next
     * event retries anyway. A caller that DOES want the outcome awaits {@link post} instead.
     */
    private send(command: DirectorCommand): void {
        void this.post(command).catch(error => this.logger.warn(`director: a ${command.kind} command failed (${message(error)})`));
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

            case 'standDown':
                await this.standDown();
                return undefined;

            case 'putOnAir':
                await this.putOnAir(command.binding, command.tracks);
                return undefined;

            case 'appendTracks':
                await this.appendTracks(command.tracks);
                return undefined;

            case 'edit':
                return await this.edit(command.edit);
        }
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
        // Retract FIRST, then rebuild. What the player is holding belongs to the programme
        // coming off, and leaving it there would air a few records of it behind the new one.
        // What is ON AIR is left alone: changing the programming is not a reason to cut a
        // listener off mid-record.
        this.rundown.retract();

        const lineup = this.lineup ?? new StationLineup(binding);
        lineup.rebind(binding);
        lineup.replaceFrom(tracks);
        this.lineup = lineup;
        this.rundown.attach(lineup);
        await this.persist();

        await this.inScope(async scope => scope.get(StationAirRepository).goOnAir());
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
        await this.commit();
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

        const result = this.applyTo(lineup, edit);
        if (!result.ok) return result;

        await this.persist();
        // After the write, because the row is the record and the caller is answered off the
        // edit rather than off this: a break whose words are never collected is untidy, and one
        // whose removal was not written down is the bug.
        if (edit.kind === 'remove') await this.collectRemoved(lineup, edit.itemId);
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
    private async collectRemoved(lineup: StationLineup, itemId: string): Promise<void> {
        const item = lineup.find(itemId);
        if (item?.kind !== 'segment') return;

        const stillWanted = lineup
            .all()
            .some(other => other.id !== itemId && other.kind === 'segment' && other.segmentId === item.segmentId && other.state !== 'removed');
        if (stillWanted) return;

        try {
            await this.inScope(async scope => {
                const segments = scope.get(SegmentRepository);
                const segment = await segments.findById(item.segmentId);
                if (segment === undefined || segment.state === 'ready' || segment.state === 'failed') return;

                await segments.markFailed(item.segmentId, 'the operator removed this break from the running order', segment.state);
                this.logger.info('director: retired the break an operator removed', { segmentId: item.segmentId, from: segment.state });
            });
        } catch (error) {
            this.logger.warn(`director: could not retire the break an operator removed (${message(error)})`);
        }
    }

    private applyTo(lineup: StationLineup, edit: OrderEdit): EditResult {
        switch (edit.kind) {
            case 'shuffle':
                return lineup.shuffleRemaining();

            case 'move':
                return lineup.move(edit.itemId, edit.toIndex);

            case 'remove':
                return lineup.remove(edit.itemId);

            case 'insertSegment':
                return lineup.insertSegment(
                    edit.segmentId,
                    edit.atIndex ?? lineup.size(),
                    edit.overAtMs === undefined ? undefined : { atMs: edit.overAtMs },
                );
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

        // BEFORE committing, so a break planted this pass is in the order before anything is
        // taken from it. The other way round, the tail would be topped up first and the break
        // would land behind the records that had just been handed over.
        //
        // The refill job plants its own as it appends, which is the common case; this pass is
        // what covers an order nothing ever extends. An imported provider playlist is exactly
        // that: it never runs the generator, so without this it would play an hour of records
        // and never once say what station it is.
        await this.plantBreaks(lineup, rules);

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
            const taken = lineup
                .nextPlanned(COMMIT_LEAD)
                .filter(item => !this.rundown.isPrepared(item.id))
                .slice(0, wanted);
            const prepared = taken.length === 0 ? undefined : await this.toPlayerItems(taken);

            // ── apply ───────────────────────────────────────────────────────────────
            // One check, then the mutations, with NO await between them. That is what makes
            // the check impossible to go stale rather than merely unlikely to: the event loop
            // cannot run anything in a stretch with nothing to yield at, so the station cannot
            // be stopped underneath this the way it can underneath every await above. See
            // {@link Epoch}.
            if (!this.epoch.isCurrent(token)) return;

            if (prepared) {
                this.rundown.prepare(prepared.items);
                for (const itemId of prepared.skipped) lineup.markSkipped(itemId);

                // The order moved, so a refill decision made a moment ago is stale.
                this.extendSent = this.extendSent && lineup.remaining() < EXTEND_BELOW;
                // Throttled. Nobody is waiting on this, and both ways of being late fail the same
                // direction: the record says less has been committed than has, so the recovery
                // replays rather than skips. For a station whose order is read back at boot,
                // hearing a record again is the cheaper of the two.
                this.persistSoon();
            }
        }

        // AFTER the hand-over, deliberately the opposite way round from `plantBreaks`. The items taken
        // above are past the cursor by now, so the window this reads holds the records that have NOT
        // been handed over — which are the only ones a fetch made now can still be in time for.
        await this.ripenTrackCache(lineup);

        if (lineup.isExhausted()) {
            await this.finish(lineup, rules);
            return;
        }

        await this.topUpIfShort(lineup, rules);
    }

    /**
     * Get the audio of the next few records in hand before their slots arrive.
     *
     * An optimisation and nothing more, which is what makes it safe here: every record is playable
     * without it, because the route the player fetches records through pulls from the provider itself
     * when the station has not got the bytes yet. What this buys is that the pull happens while the
     * records ahead of it are playing rather than inside the request Liquidsoap is waiting on.
     *
     * Failures are swallowed exactly as {@link plantBreaks}'s are, and for a stronger version of the
     * same reason: the records either side play regardless, so a planner that cannot read its rows must
     * not take down the pass that keeps the running order full.
     */
    private async ripenTrackCache(lineup: StationLineup): Promise<void> {
        try {
            await this.inScope(scope => scope.get(TrackCachePlanner).ripen(lineup));
        } catch (error) {
            this.logger.warn(`director: could not fetch a record ahead of its slot (${message(error)})`);
        }
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
            await this.inScope(async scope => {
                const planner = scope.get(BreakPlanner);

                const planted = await planner.plant(lineup, rules);

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
                await planner.ripen(lineup);
            });
        } catch (error) {
            this.logger.warn(`director: could not plan breaks for the running order (${message(error)})`);
        }
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
    private async toPlayerItems(items: readonly StationLineupItem[]): Promise<{ items: RundownItem[]; skipped: string[] }> {
        const wanted = items.filter(item => item.kind === 'segment').map(item => item.segmentId);
        const segments =
            wanted.length === 0 ? new Map<string, Segment>() : await this.inScope(async scope => scope.get(SegmentRepository).findByIds(wanted));

        const playable: RundownItem[] = [];
        const skipped: string[] = [];
        // A talk-over waiting for a record to attach itself to. It may have arrived in an earlier
        // batch: see the field's own note.
        let pending = this.pendingVoice;
        this.pendingVoice = undefined;

        for (const item of items) {
            if (item.kind === 'track') {
                // The order's own id, carried through unchanged. It rides the annotation into
                // Liquidsoap and comes back on its readings, which is what lets a restarted
                // process name the record a listener is in the middle of.
                playable.push({
                    ...item.track,
                    id: item.id,
                    ...(pending === undefined ? {} : { voice: { segmentId: pending.segmentId, atMs: pending.atMs } }),
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
                skipped.push(item.id);
                continue;
            }

            // The other end of the forward claim. A break saying "coming up, X" named a LINE when it
            // was written, minutes ago, and the words are now baked into audio that cannot be
            // re-cut. Everything that can happen to a running order in that gap makes them false: an
            // operator moves the item, a request goes in, the resolver drops the pick, the record is
            // skipped for having no audio. The station would then name a record that is not the one
            // playing, in a confident voice, which is the kind of error a listener remembers.
            //
            // So it is checked here, against the order as it stands at the instant of hand-over, and
            // a claim that no longer holds costs the break. Silence on one boundary beats a wrong
            // fact — the same trade the station already makes by skipping a segment that is not
            // ready, taken through the same branch, so the order does not lose its lead either.
            const promised = segment.claimsItemId;
            const actuallyNext = promised === undefined ? undefined : this.lineup?.nextTrackAfter(item.id);
            if (promised !== undefined && actuallyNext?.id !== promised) {
                this.logger.info('director: dropping a break whose running order has moved under it', {
                    segment: item.segmentId,
                    claimed: promised,
                    // `nothing` for a break at the end of an order that has since lost its tail: the
                    // promise is equally unkeepable, and equally not worth airing.
                    next: actuallyNext?.id ?? 'nothing',
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
                pending = { itemId: item.id, segmentId: segment.id, atMs: item.over.atMs };
                continue;
            }

            playable.push({ ...segmentRundownTrack(segment), id: item.id });
        }

        // Held for the next pass rather than dropped. A batch is only three items, so a talk-over
        // planted before the last record of one lands here roughly a third of the time, and
        // discarding it would silently lose that many breaks. It is cleared wherever the plan
        // changes, alongside the epoch it would otherwise outlive.
        this.pendingVoice = pending;
        return { items: playable, skipped };
    }

    /** Prepare these items and mark whatever the station will pass over. */
    private async prepareForPlayer(items: readonly StationLineupItem[]): Promise<void> {
        const prepared = await this.toPlayerItems(items);
        this.rundown.prepare(prepared.items);
        for (const itemId of prepared.skipped) this.lineup?.markSkipped(itemId);
    }

    /**
     * Send a refill when the tail is getting short.
     *
     * Guarded, because a burst of rundown events would otherwise queue a dozen
     * identical jobs for one shortfall. The guard clears when the order has
     * actually grown, which is the only evidence the last one landed.
     */
    private async topUpIfShort(lineup: StationLineup, rules: ResolvedRules): Promise<void> {
        if (!rules.autoExtend || lineup.remaining() >= EXTEND_BELOW) {
            this.extendSent = false;
            return;
        }
        if (this.extendSent) return;

        // The guard is set only once the send has actually landed. Setting it first means a send
        // that throws latches it forever: nothing clears the guard until the order grows, and the
        // order cannot grow until a refill is sent. One failure and the station never refills
        // again, which is how this one spent an afternoon silent.
        try {
            await this.jobs.send('director.extend_lineup', {});
        } catch (error) {
            // Swallowed on purpose, and the guard is left clear so the next boundary asks again.
            // A refill that could not be sent must not take the commit pass down with it: the
            // order still has items, the station is still playing them, and the pass this is the
            // tail of is what keeps the running order full.
            this.logger.warn(`director: could not ask for a refill (${message(error)})`);
            return;
        }
        this.extendSent = true;

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
    private remember(item: RundownItem): void {
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

        void this.inScope(async scope => scope.get(PlayHistoryRepository).record({ item, source })).catch(error =>
            // One lost row costs a little accuracy in the repeat window. Nothing about
            // the broadcast depends on it, and the boundary must not be held up.
            this.logger.warn(`director: could not record what aired (${message(error)})`),
        );
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
        this.extendSent = false;
        this.airReadAt = 0;
        this.standingDown = true;
    }

    /** Remember that the station is off, so a restart stays off. */
    private async standDown(): Promise<void> {
        // Idempotent, and called directly by the `standDown` command as well as after
        // {@link beginStandDown}. A stand-down reached any other way still has to cancel.
        this.beginStandDown();

        try {
            await this.inScope(async scope => scope.get(StationAirRepository).standDown());
            // What the player was holding was retracted with it, and the states saying so are
            // worth keeping: they are what a console draws as the running order this station
            // stopped part-way through.
            await this.persist();
        } catch (error) {
            // The intent stands even if the write did not. Leaving `standingDown` set
            // keeps this process off air, which is the safe half of the failure: the
            // alternative is a station that resumes because its own note did not save.
            this.logger.warn(`director: could not record the stand-down (${message(error)})`);
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
            void this.persist().catch(error => this.logger.warn(`director: could not write the running order down (${message(error)})`));
        }, PERSIST_THROTTLE_MS);
        this.persistTimer.unref?.();
    }

    /** Write now if the throttle owes anything, and forget the timer. */
    private async flushPersist(): Promise<void> {
        if (!this.persistTimer) return;

        clearTimeout(this.persistTimer);
        this.persistTimer = undefined;
        await this.persist().catch(error => this.logger.warn(`director: could not write the running order down (${message(error)})`));
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
        await this.inScope(async scope => scope.get(StationLineupRepository).save(lineup.toSnapshot()));
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

        this.air = await this.inScope(async scope => scope.get(StationAirRepository).get(MAIN_SLOT));
        this.airReadAt = Date.now();
        return this.air;
    }

    /**
     * Run one unit of database work in its own scope.
     *
     * This is a singleton and the repositories are scoped, so there is no ambient
     * request to borrow a connection from. Each call opens and disposes its own,
     * which is what `PlayoutModule.ready` does for the same reason.
     */
    private async inScope<T>(work: (scope: Container) => Promise<T>): Promise<T> {
        const scope = this.container.createScopedContainer();
        try {
            return await work(scope);
        } finally {
            await scope.disposeAsync();
        }
    }
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
