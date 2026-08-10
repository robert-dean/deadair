import { Container, Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { AIR_MODE_KEY, parseAirMode, type AirMode } from '#modules/playout/air.mode.js';
import { AudienceWatch } from '#modules/playout/audience.watch.js';
import { Epoch } from '#modules/shared/epoch.js';
import { Rundown, type RetractedLines, type RundownItem, type RundownTrack } from '#modules/playout/rundown.js';
import { SegmentRepository, type Segment } from '#modules/render/segment.repository.js';
import { isRenderItem, segmentRundownTrack } from '#modules/render/segment.source.js';
import { BreakPlanner } from './break.planner.js';
import { DirectorMailbox, type DirectorCommand } from './director.mailbox.js';
import type { Lineup, LineupItem } from './lineup.js';
import { LineupRepository } from './lineup.repository.js';
import { PlayHistoryRepository } from './play.history.repository.js';
import { resolveRules, stationRules, type ResolvedRules } from './rotation.rules.js';
import { MAIN_SLOT, StationAirRepository, type StationAir } from './station.air.repository.js';

/**
 * How many items to keep in the running order beyond what is airing.
 *
 * Small on purpose. The lineup is the deep plan and the rundown is a window onto
 * it, so committing further ahead buys nothing and costs everything an operator
 * edit could have changed: an item handed to the player is one they can no
 * longer reorder or remove. Two or three is enough for the pusher to keep the
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
 * How often to notice that the plan has been changed under us.
 *
 * The one timer in this class, and it exists because the reactor's premise — that rundown events
 * arrive often enough to drive everything — is not quite true. Those events come from the player
 * doing things, and a station playing a four-minute record produces none for four minutes. A plan
 * change cannot wait that long: an operator who edits what is on air expects the station to notice
 * before the next boundary, and a refill that lands is worthless until the reactor re-reads it.
 *
 * It does nothing at all unless {@link invalidate} has been called, so an idle station still costs
 * one flag comparison a second and no queries.
 */
const STALE_CHECK_MS = 1_000;

/**
 * The music director: the actor that keeps the station's running order full from
 * a lineup, remembers what aired, and decides what happens when a lineup ends.
 *
 * It REACTS rather than schedules. The rundown announces a change (an item
 * handed over, an item confirmed on air) and this commits whatever that leaves
 * room for, which means the station is driven by what the player has actually
 * done rather than by a clock guessing at it. There is no timer here at all: the
 * pusher already reconciles against Liquidsoap every couple of seconds, and its
 * work produces the events this listens to.
 *
 * One per process, for the reason `Rundown` and `PlayoutPusher` are: it holds
 * subscriptions and the loaded lineup, and a per-request copy would hand every
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
    /** The lineup on air, loaded with the cursor this broadcast has reached. */
    private lineup?: Lineup;
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
    /** One commit pass at a time: appending to the rundown emits a change, which re-enters here. */
    private busy = false;
    /** A wake that arrived mid-pass. Coalesced rather than dropped; see {@link commit}. */
    private pending = false;
    /** A refill is already queued. Cleared once the lineup has actually grown. */
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
     * Bumped wherever the plan this pass was computed against stops being the plan:
     * a stand-down, a different lineup put on air, a reload.
     *
     * It replaces a pair of flags read at the top of the pass, and covers what they
     * could not. `standingDown` answers "was it stopped"; this answers "is anything
     * different", which stays the right question as new ways to change what is on
     * air are added — and there are several coming.
     */
    private readonly epoch = new Epoch();
    /**
     * The one way in, and eventually the only one.
     *
     * Introduced alongside the flags above rather than instead of them, on purpose. Every writer
     * has to be moved onto it before any of them can be deleted, and a queue that is provably inert
     * is the only honest place to start: the existing tests pass unchanged against this, which is
     * the evidence that it changed nothing.
     */
    private readonly mailbox = new DirectorMailbox(command => this.handle(command));
    /**
     * A talk-over whose record has not been committed yet.
     *
     * A commit batch is three items, so a talk-over planted before the last record of a batch has
     * nothing in that batch to ride on. Rather than drop it — which would lose a third of them —
     * it waits here for the first record of the next batch.
     *
     * Cleared wherever the plan changes, because a cue is about a particular record in a particular
     * running order, and one held across a stand-down or a change of lineup would attach itself to
     * the first record of something else entirely.
     */
    private pendingVoice?: { segmentId: string; atMs: number };
    /**
     * Something changed the plan and this reactor has not re-read it yet.
     *
     * Deliberately a flag consumed on a LATER pass rather than a re-read done on the spot, and that
     * is the whole point of it. Every writer that changes the plan is inside a request, and every
     * request runs inside one database transaction that commits when it ends
     * (`audit.context.middleware`). This class reads through a scope it opens itself, on another
     * connection, so a re-read performed during that request sees the state BEFORE the write.
     *
     * That is not theoretical. It is why putting the on-air lineup back on air left the cursor
     * where it was rather than at the top: the row said zero and the re-read, one connection away,
     * still saw the old value — and because the lineup id had not changed, nothing re-read it
     * afterwards either.
     */
    private stale = false;
    private staleTimer?: NodeJS.Timeout;
    private readonly unsubscribes: (() => void)[] = [];

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
        // own Stop, or this class reaching the end of a lineup that says to stop. The
        // director has to hear it, or the next change event refills the running order
        // and the station is back on air a second after the operator stopped it.
        this.unsubscribes.push(
            this.rundown.onReset((standingDown, retracted) => {
                // Before the stand-down, and for both kinds of reset. A replacement retracts the
                // tail and leaves the station on air; a stand-down retracts everything. Either way
                // the cursor has counted lines nobody heard, and the correction is the same.
                this.reclaimRetracted(retracted);
                if (!standingDown) return;

                // Cancel first, in this stack frame, then queue the write. See `beginStandDown`:
                // a command cannot cancel a pass that is already gathering, because it runs after
                // it.
                this.beginStandDown();
                this.send({ kind: 'standDown' });
            }),
        );

        this.staleTimer = setInterval(() => this.refreshIfStale(), STALE_CHECK_MS);
        this.staleTimer.unref?.();

        // Last, and the listeners above are armed first on purpose: this restore
        // ends in a commit pass that can reach the end of a lineup and stand the
        // station down, which is a `Rundown.reset` this class has to hear.
        await this.restore();
    }

    /** Stop driving. The player keeps whatever it already holds. */
    stop(): void {
        if (this.staleTimer) clearInterval(this.staleTimer);
        this.staleTimer = undefined;
        for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    }

    /**
     * Something changed the plan: re-read it before doing anything else.
     *
     * What every writer should call instead of {@link reload}, and the difference is the
     * transaction rather than the timing. A caller inside a request has not committed yet, so a
     * re-read it triggers directly reads the state before its own write; this defers that read to
     * a pass that happens after the request is over. See {@link stale}.
     *
     * Cheap and idempotent: several edits in one request cost one re-read.
     *
     * **Bumps the epoch as well as raising the flag, and the two cover different passes.** The flag
     * stops every pass that starts AFTER this. The bump is the only thing that stops the one
     * already in flight: it took its token and made its own `stale` check before this was called,
     * and it is suspended in a database read — `readAir`, `plantBreaks`, a segment lookup — which
     * is exactly where a request handler runs. Without the bump it resumes, passes its check at the
     * hand-over, and appends the OLD lineup's records into the running order `putOnAir` has just
     * retracted. Three of them, which is a quarter of an hour of the programme the operator has
     * just taken off air.
     */
    invalidate(): void {
        this.epoch.bump();
        // A cue is about a particular record in a particular running order; one held across a
        // change of lineup attaches itself to the first record of something else entirely.
        this.pendingVoice = undefined;
        this.stale = true;
    }

    /**
     * Re-read the plan, if something has said it changed.
     *
     * Driven only by the timer, and that is the load-bearing part rather than an implementation
     * detail. The obvious design — check the flag at the top of a commit pass — reintroduces the
     * exact bug this exists to fix: `putOnAir` calls `Rundown.load([])`, whose change event fires a
     * pass synchronously, still inside the request whose transaction has not committed. That pass
     * would consume the flag and re-read the state from before the write. Waiting for the timer
     * costs up to a second and is always on the far side of the request.
     *
     * Safe against a pass already in flight: {@link restore} bumps the epoch, so a pass that has
     * gathered against the old plan fails its check and commits nothing rather than applying a
     * decision made from a plan that has just been replaced.
     */
    private refreshIfStale(): void {
        if (!this.stale) return;
        this.stale = false;

        this.restore().catch(error => {
            // Left stale so the next tick tries again: the alternative is a reactor that quietly
            // keeps airing a plan it has been told is wrong.
            this.stale = true;
            this.logger.warn(`director: could not re-read the plan (${message(error)})`);
        });
    }

    /**
     * Re-read what is on air and act on it.
     *
     * Called by the console after it changes `station_air`, so an operator's "put
     * this on air" takes effect on the instant rather than at the next boundary.
     */
    async reload(): Promise<void> {
        this.epoch.bump();
        this.pendingVoice = undefined;
        this.airReadAt = 0;
        this.lineup = undefined;
        await this.restore();
    }

    /** What the director is doing, for a console that has to draw it. */
    status(): { active: boolean; airMode: AirMode; lineupId?: string; cursor: number; remaining: number } {
        return {
            active: this.active,
            airMode: this.airMode,
            ...(this.lineup === undefined ? {} : { lineupId: this.lineup.id }),
            cursor: this.lineup?.cursor() ?? 0,
            remaining: this.lineup?.remaining() ?? 0,
        };
    }

    /**
     * Read `station_air`, load whatever it names, and commit if the station is
     * meant to be on.
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

        if (!air?.lineupId) {
            this.lineup = undefined;
            return;
        }

        this.lineup = await this.inScope(async scope => scope.get(LineupRepository).load(air.lineupId!, air.cursor));
        if (!this.lineup) {
            this.logger.warn('director: the lineup on air no longer exists', { lineup: air.lineupId });
            this.active = false;
            return;
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
    async post(command: DirectorCommand): Promise<void> {
        await this.mailbox.post(command);
    }

    /**
     * What each command actually does.
     *
     * Deliberately thin. A command names a decision and this routes it; the work stays in the
     * methods that already do it, so the mailbox is a way IN rather than a second place where the
     * station's behaviour lives.
     */
    private async handle(command: DirectorCommand): Promise<void> {
        switch (command.kind) {
            case 'wake':
                await this.commit();
                return;

            case 'standDown':
                await this.standDown();
                return;

            case 'putOnAir':
                // Retract FIRST, then read. What the player is holding belongs to the lineup
                // coming off, and leaving it there would air a few records of the old programme
                // behind the new one. What is ON AIR is left alone by `load`: changing the
                // programming is not a reason to cut a listener off mid-record.
                this.rundown.load([]);
                this.stale = false;
                await this.restore();
                return;

            case 'planChanged':
                // No retraction. An edit to the part nobody has heard yet says nothing about the
                // part they are about to.
                this.stale = false;
                await this.restore();
                return;
        }
    }

    /**
     * Top the running order up to the lead, and deal with a lineup that has run
     * out.
     *
     * Everything here is driven off what the rundown says it is holding rather
     * than off a count kept here, because the rundown is the one that knows: a
     * push the player never took is re-queued there, and an item skipped for
     * failing to resolve leaves a hole this has to fill.
     */
    private async commit(): Promise<void> {
        // A wake that lands mid-pass is REMEMBERED, not dropped. Several arrive per
        // track boundary — the item handed over and the item confirmed on air are two
        // separate events a few milliseconds apart — and a pass that started before
        // the second one computed its depth from a rundown that has since changed.
        // Dropping it leaves the running order one item short until the next event.
        if (this.busy) {
            this.pending = true;
            return;
        }
        this.busy = true;
        // Taken before the first await of the pass, and checked immediately before anything is
        // handed over. Everything below this line runs with the event loop free at each await, and
        // the operator's Stop, a lineup put on air, and a reload all land there.
        const token = this.epoch.current();

        try {
            // Told the plan is wrong, and not yet re-read: do nothing at all.
            //
            // Not just an optimisation. A pass here would commit from the in-memory plan and then
            // WRITE the cursor it reached, on its own connection, which lands after the request
            // that just reset that cursor to zero has committed — so the reset is undone by the
            // reactor moments after it is made. That is what "put this lineup on air" hit: the row
            // said start from the top and the reactor put its own position back a moment later.
            //
            // Cheap and synchronous, so an invalidated station costs one comparison per event
            // until the timer re-reads it.
            if (this.stale) return;

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

            if (air?.lineupId && air.lineupId !== this.lineup?.id) {
                await this.restore();
                return;
            }

            const lineup = this.lineup;
            if (!lineup) return;

            const rules = resolveRules(lineup.mode, lineup.rules, stationRules(this.config));

            // BEFORE committing, so a break planted this pass is in the order before anything is
            // taken from it. The other way round, the tail would be topped up first and the break
            // would land behind the records that had just been handed over.
            //
            // The refill job plants its own as it appends, which is the common case; this pass is
            // what covers a lineup nothing ever extends. An imported provider playlist is exactly
            // that: it never runs the generator, so without this it would play an hour of records
            // and never once say what station it is.
            await this.plantBreaks(lineup, rules);

            const held = this.rundown.upcoming().length;
            if (held < COMMIT_LEAD) {
                // ── gather ──────────────────────────────────────────────────────────────
                // Everything slow, and nothing changed. `peekNext` is pure, so a segment that
                // turns out not to be ready — or a database that will not answer — costs this
                // pass and nothing else. Moving the cursor first and then doing this work is how
                // a failure in the middle loses programming for good: the lines are behind the
                // cursor, so nothing will ever offer them again.
                const peeked = lineup.peekNext(COMMIT_LEAD - held);
                const tracks = peeked.items.length === 0 ? [] : await this.toRundownTracks(peeked.items);

                // ── apply ───────────────────────────────────────────────────────────────
                // One check, then two synchronous mutations, with NO await between them. That is
                // what makes the check impossible to go stale rather than merely unlikely to:
                // the event loop cannot run anything in a stretch with nothing to yield at, so
                // the station cannot be stopped underneath this the way it can underneath every
                // await above. See {@link Epoch}.
                if (!this.epoch.isCurrent(token)) return;

                if (tracks.length > 0) this.rundown.append(tracks);
                lineup.advance(peeked.cursor);

                // The cursor moved, so a refill decision made a moment ago is stale.
                if (peeked.items.length > 0) this.extendSent = this.extendSent && lineup.remaining() < EXTEND_BELOW;

                // Persisted after the hand-over, deliberately. See `Lineup.saveCursor`.
                if (peeked.items.length > 0) await lineup.saveCursor();
            }

            if (lineup.isExhausted()) {
                await this.finish(lineup, rules);
                return;
            }

            await this.topUpIfShort(lineup, rules);
        } finally {
            this.busy = false;
            if (this.pending) {
                this.pending = false;
                // Not awaited: this is the tail of a pass, and the caller was a listener
                // with nobody to hand a rejection to. `wake` carries its own catch.
                this.wake();
            }
        }
    }

    /**
     * Take back the position spent on lines the player was handed and then had
     * taken away from it.
     *
     * **The one place the plan is corrected by the fact.** Committing a line is a
     * promise and airing it is a fact, and a retraction is where they come apart:
     * the cursor has already counted those lines, so without this they sit behind
     * it, where nothing will ever offer them again and every editor refuses them as
     * `already-aired`. That is programming the operator planned, paid for and never
     * heard, lost silently.
     *
     * Driven by the retraction rather than measured from the steady state, and that
     * distinction is the whole correctness of it. Three things make "look at what the
     * rundown holds and infer the position" wrong, and each was found the hard way:
     *
     * - An item merely HANDED OVER has not been dropped. The pusher runs a lead ahead
     *   of the listener by design, so treating those as unheard commits them twice
     *   and the listener hears the record twice.
     * - A line can legitimately produce NO rundown item. A talk-over rides on the
     *   record after it and a segment that is not ready is skipped, so the newest
     *   item in the rundown can sit several lines behind the cursor with nothing
     *   wrong.
     * - Putting a lineup back on air deliberately resets the cursor to the top while
     *   the record it committed last time is still playing. Inferring from the player
     *   there would undo the operator's own decision.
     *
     * The two arms come from {@link RetractedLines} and are not interchangeable. An
     * unheard line is offered again from the top; the line that was ON AIR was heard,
     * so the cursor goes just PAST it rather than replaying a record mid-way through.
     *
     * Walks the unheard lines in air order and stops at the first this lineup still
     * holds, because that is the earliest point the plan has to go back to. A line
     * this lineup does not recognise is skipped rather than ending the walk: after a
     * change of programming the retraction is full of the previous lineup's lines.
     *
     * In memory only, deliberately. Persisting here would race the very request that
     * caused the retraction — `putOnAir` writes `cursor = 0` inside its own
     * transaction and this runs synchronously from its `Rundown.load([])` — so the
     * write is left to the next commit pass, which is also the first moment it could
     * be true.
     */
    private reclaimRetracted(retracted: RetractedLines): void {
        const lineup = this.lineup;
        if (!lineup) return;

        for (const planId of retracted.unheard) {
            if (lineup.rewindToStartOf(planId)) return;
        }
        if (retracted.aired !== undefined) lineup.rewindTo(retracted.aired);
    }

    /**
     * Put the station's own segments into the lineup, where the rules say there
     * should be some and there are not.
     *
     * Costs nothing on the overwhelming majority of passes: the planner walks the
     * order in memory and only reaches the database when it has found somewhere to
     * put something, so a lineup whose breaks are already in place is a loop over
     * an array and no query at all.
     *
     * Failures are swallowed on purpose. A break is the one thing in a commit pass
     * the broadcast does not depend on — the records either side of it play
     * regardless — so a planner that cannot read its library must not be allowed
     * to take down the pass that keeps the running order full.
     */
    private async plantBreaks(lineup: Lineup, rules: ResolvedRules): Promise<void> {
        try {
            await this.inScope(async scope => scope.get(BreakPlanner).plant(lineup, rules));
        } catch (error) {
            this.logger.warn(`director: could not plan breaks for this lineup (${message(error)})`);
        }
    }

    /**
     * Turn the lines just taken from the lineup into a running order.
     *
     * A record passes straight through: the lineup already holds everything the
     * player needs. A segment is a reference, so its row is read here — and a
     * segment that is not `ready` is **skipped**, not waited for.
     *
     * That rule is the whole reason the running order can hold something the
     * station has not finished making. A director that held the slot open would
     * hand the listener silence for as long as a renderer took, and a renderer
     * that failed would hold it open forever. Skipping costs an ident nobody
     * hears; stalling costs the broadcast.
     *
     * One read for the whole batch rather than one per line, because a commit
     * pass runs on every track boundary and the lead is only three items.
     */
    private async toRundownTracks(items: readonly LineupItem[]): Promise<RundownTrack[]> {
        const wanted = items.filter(item => item.kind === 'segment').map(item => item.segmentId);
        const segments =
            wanted.length === 0 ? new Map<string, Segment>() : await this.inScope(async scope => scope.get(SegmentRepository).findByIds(wanted));

        const tracks: RundownTrack[] = [];
        // A talk-over waiting for a record to attach itself to. It may have arrived in an earlier
        // batch: see the field's own note.
        let pending = this.pendingVoice;
        this.pendingVoice = undefined;

        for (const item of items) {
            if (item.kind === 'track') {
                // `planId` is stamped HERE and nowhere else. It is what lets `rewindToAir` ask the
                // player which line the listener is actually on, and the lineup's own item never
                // carries it: see the field's note in `rundown.ts`.
                tracks.push({ ...item.track, planId: item.id, ...(pending === undefined ? {} : { voice: pending }) });
                pending = undefined;
                continue;
            }

            const segment = segments.get(item.segmentId);
            if (segment?.state !== 'ready') {
                this.logger.info('director: skipping a segment that is not ready to air', {
                    segment: item.segmentId,
                    // `gone` rather than a state, for a row the lineup names and the library no
                    // longer holds. Distinguishable in a log, and the same outcome either way.
                    state: segment?.state ?? 'gone',
                });
                continue;
            }

            // A talk-over is not an item and never becomes one: it is heard ALONGSIDE the record
            // that follows it rather than in the gap before it, so it rides on that record and the
            // pusher arms it as the record is handed over.
            //
            // Two of them in a row would be one talking over the other, so the later one wins and
            // the earlier is dropped. That is a programming mistake rather than a fault, and the
            // alternative — queueing them — is two voices at once.
            if (item.over !== undefined) {
                if (pending !== undefined) {
                    this.logger.info('director: two talk-overs in a row; keeping the later one', { dropped: pending.segmentId });
                }
                pending = { segmentId: segment.id, atMs: item.over.atMs };
                continue;
            }

            tracks.push({ ...segmentRundownTrack(segment), planId: item.id });
        }

        // Held for the next pass rather than dropped. A batch is only three items, so a talk-over
        // planted before the last record of one lands here roughly a third of the time, and
        // discarding it would silently lose that many breaks. It is cleared wherever the plan
        // changes, alongside the epoch it would otherwise outlive.
        this.pendingVoice = pending;
        return tracks;
    }

    /**
     * Send a refill when the tail is getting short.
     *
     * Guarded, because a burst of rundown events would otherwise queue a dozen
     * identical jobs for one shortfall. The guard clears when the lineup has
     * actually grown, which is the only evidence the last one landed.
     */
    private async topUpIfShort(lineup: Lineup, rules: ResolvedRules): Promise<void> {
        if (!rules.autoExtend || lineup.remaining() >= EXTEND_BELOW) {
            this.extendSent = false;
            return;
        }
        if (this.extendSent) return;

        // The guard is set only once the send has actually landed. Setting it first means a send
        // that throws latches it forever: nothing clears the guard until the lineup grows, and the
        // lineup cannot grow until a refill is sent. One failure and the station never refills
        // again, which is how this one spent an afternoon silent.
        try {
            await this.jobs.send('director.extend_lineup', { lineupId: lineup.id });
        } catch (error) {
            // Swallowed on purpose, and the guard is left clear so the next boundary asks again.
            // A refill that could not be sent must not take the commit pass down with it: the
            // lineup still has items, the station is still playing them, and the pass this is the
            // tail of is what keeps the running order full.
            this.logger.warn(`director: could not ask for a refill (${message(error)})`);
            return;
        }
        this.extendSent = true;

        this.logger.info('director: the lineup is running short; a refill is on its way', {
            lineup: lineup.id,
            remaining: lineup.remaining(),
        });
    }

    /**
     * A lineup has reached its end. What happens next is the operator's decision,
     * recorded on the lineup itself.
     *
     * Nothing here cuts the listener off: the items already committed keep
     * playing, and this only decides what is committed after them.
     *
     * None of these branches commits anything itself. They rearrange what is on
     * air and then return, because this runs INSIDE a commit pass and re-entering
     * one would be refused by its own guard anyway. The next pass is at most a
     * couple of seconds away — the pusher's reconcile produces one whether or not
     * the running order changed — and there is a track playing throughout.
     */
    private async finish(lineup: Lineup, rules: ResolvedRules): Promise<void> {
        switch (lineup.onEnd) {
            case 'repeat':
                await lineup.rewind();
                return;

            case 'extend':
                // The refill has either landed (and this is not exhausted after all) or
                // is still in flight. Either way the guard below is the whole handling:
                // it will be sent once, and the next boundary picks up what arrives.
                await this.topUpIfShort(lineup, rules);
                return;

            case 'resume': {
                const air = await this.readAir(true);
                if (!air?.resumeLineupId) {
                    this.logger.info('director: nothing to resume at the end of a lineup; standing down', { lineup: lineup.id });
                    this.rundown.reset();
                    return;
                }
                await this.inScope(async scope => scope.get(StationAirRepository).resume(air.resumeLineupId!, air.resumeCursor ?? 0));
                this.logger.info('director: a lineup ended; resuming what it interrupted', {
                    ended: lineup.id,
                    resuming: air.resumeLineupId,
                });
                await this.reload();
                return;
            }

            case 'rotation': {
                const air = await this.readAir(true);
                if (!air?.defaultLineupId) {
                    // Naming no home programming is a choice, not an oversight to paper over
                    // with a lineup nobody picked.
                    this.logger.info('director: no home programming to fall back to; standing down', { lineup: lineup.id });
                    this.rundown.reset();
                    return;
                }
                await this.inScope(async scope => scope.get(StationAirRepository).putOnAir(air.defaultLineupId!));
                await this.reload();
                return;
            }

            case 'stop':
            default:
                this.logger.info('director: the lineup ended and says to stop; standing down', { lineup: lineup.id });
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
        } catch (error) {
            // The intent stands even if the write did not. Leaving `standingDown` set
            // keeps this process off air, which is the safe half of the failure: the
            // alternative is a station that resumes because its own note did not save.
            this.logger.warn(`director: could not record the stand-down (${message(error)})`);
            return;
        }
        this.standingDown = false;
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
