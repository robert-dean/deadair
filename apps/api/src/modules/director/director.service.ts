import { Container, Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { Rundown, type RundownItem } from '#modules/playout/rundown.js';
import type { Lineup } from './lineup.js';
import { LineupRepository } from './lineup.repository.js';
import { PlayHistoryRepository } from './play.history.repository.js';
import { resolveRules } from './rotation.rules.js';
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
    private readonly unsubscribes: (() => void)[] = [];

    constructor(
        private readonly rundown: Rundown,
        private readonly container: Container,
        private readonly jobs: PgBossJobBroker,
        private readonly logger: Logger,
    ) {}

    /** Begin driving. Idempotent. */
    async start(): Promise<void> {
        if (this.unsubscribes.length > 0) return;

        this.unsubscribes.push(this.rundown.onChange(() => this.wake()));
        this.unsubscribes.push(this.rundown.onAired(item => this.remember(item)));
        // A stand-down is the station being stopped, from wherever: the transport's
        // own Stop, or this class reaching the end of a lineup that says to stop. The
        // director has to hear it, or the next change event refills the running order
        // and the station is back on air a second after the operator stopped it.
        this.unsubscribes.push(
            this.rundown.onReset(standingDown => {
                if (standingDown) void this.standDown();
            }),
        );

        await this.restore();
    }

    /** Stop driving. The player keeps whatever it already holds. */
    stop(): void {
        for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    }

    /**
     * Re-read what is on air and act on it.
     *
     * Called by the console after it changes `station_air`, so an operator's "put
     * this on air" takes effect on the instant rather than at the next boundary.
     */
    async reload(): Promise<void> {
        this.airReadAt = 0;
        this.lineup = undefined;
        await this.restore();
    }

    /** What the director is doing, for a console that has to draw it. */
    status(): { active: boolean; lineupId?: string; cursor: number; remaining: number } {
        return {
            active: this.active,
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

    /** Fire a commit pass from a listener, swallowing anything it throws. */
    private wake(): void {
        this.commit().catch(error => this.logger.warn(`director: a commit pass failed (${message(error)})`));
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

        try {
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

            const held = this.rundown.upcoming().length;
            if (held < COMMIT_LEAD) {
                const items = await lineup.takeNext(COMMIT_LEAD - held);
                if (items.length > 0) {
                    this.rundown.append(items.map(item => item.track));
                    // The cursor moved, so a refill decision made a moment ago is stale.
                    this.extendSent = this.extendSent && lineup.remaining() < EXTEND_BELOW;
                }
            }

            if (lineup.isExhausted()) {
                await this.finish(lineup);
                return;
            }

            await this.topUpIfShort(lineup);
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
     * Send a refill when the tail is getting short.
     *
     * Guarded, because a burst of rundown events would otherwise queue a dozen
     * identical jobs for one shortfall. The guard clears when the lineup has
     * actually grown, which is the only evidence the last one landed.
     */
    private async topUpIfShort(lineup: Lineup): Promise<void> {
        const rules = resolveRules(lineup.mode, lineup.rules);
        if (!rules.autoExtend || lineup.remaining() >= EXTEND_BELOW) {
            this.extendSent = false;
            return;
        }
        if (this.extendSent) return;

        this.extendSent = true;
        await this.jobs.send('director.extend_lineup', { lineupId: lineup.id });
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
    private async finish(lineup: Lineup): Promise<void> {
        switch (lineup.onEnd) {
            case 'repeat':
                await lineup.rewind();
                return;

            case 'extend':
                // The refill has either landed (and this is not exhausted after all) or
                // is still in flight. Either way the guard below is the whole handling:
                // it will be sent once, and the next boundary picks up what arrives.
                await this.topUpIfShort(lineup);
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
        const source = this.lineup?.source ?? 'director';

        void this.inScope(async scope => scope.get(PlayHistoryRepository).record({ item, source })).catch(error =>
            // One lost row costs a little accuracy in the repeat window. Nothing about
            // the broadcast depends on it, and the boundary must not be held up.
            this.logger.warn(`director: could not record what aired (${message(error)})`),
        );
    }

    /** Stop driving and remember that the station is off, so a restart stays off. */
    private async standDown(): Promise<void> {
        this.active = false;
        this.extendSent = false;
        this.airReadAt = 0;
        this.standingDown = true;

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
