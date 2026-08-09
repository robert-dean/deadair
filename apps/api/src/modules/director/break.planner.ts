import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { SegmentRepository, type Segment } from '#modules/render/segment.repository.js';
import { SpeechService } from '#modules/render/speech.service.js';
import { BreakWriterRegistry } from './break.writer.registry.js';
import type { Lineup, LineupItem } from './lineup.js';
import type { ResolvedRules } from './rotation.rules.js';
import { TALK_BREAK_KIND } from './talk.break.writer.js';

/**
 * The kind of break whose audio already exists, because somebody recorded it and
 * dropped it in the inbox.
 *
 * A station ident is the thing every station does, and it is what this plants
 * when the station cannot write and speak one of its own.
 */
const IDENT_KIND = 'ident';

/**
 * How far past the cursor a break may be planted.
 *
 * Never into the window the director is about to hand over. An item already
 * committed is one an operator can no longer move or remove, and dropping a
 * break into that window would be programming the station a listener is already
 * hearing.
 *
 * It also buys the thing the next piece of work needs: a segment planted this
 * far out has whole records of airtime before its slot arrives, which is the
 * difference between a renderer having time to finish and the director skipping
 * a break that was never ready. Nothing renders yet, so today this is only about
 * the operator's reach.
 */
export const PLANT_AHEAD = 4;

/**
 * The station putting its own segments into a lineup.
 *
 * The rule is one break every `breakEveryItems` RECORDS. Segments do not count
 * toward that spacing, which matters once there is more than one kind of them: a
 * news bulletin dropped in by something else should not push the next ident back
 * an hour, because the listener is counting songs since they last heard the
 * station's name, not items since they last heard a voice.
 *
 * Idempotent by construction rather than by a guard. It counts the distance since
 * the last segment ALREADY in the order, so a second pass over a lineup it has
 * just planted into finds every gap short and plants nothing. That is what makes
 * it safe to call from the director's commit pass, which runs on every track
 * boundary.
 *
 * Scoped, like the repositories it reads: it is called from a job's scope and
 * from the scope the director opens per unit of work.
 */
@Injectable()
export class BreakPlanner {
    constructor(
        private readonly segments: SegmentRepository,
        private readonly writers: BreakWriterRegistry,
        private readonly speech: SpeechService,
        private readonly jobs: PgBossJobBroker,
        private readonly logger: Logger,
    ) {}

    /**
     * Plant whatever breaks the tail is missing. Answers how many went in.
     *
     * Reads the library only when there is somewhere to put something, so the
     * ordinary case — a lineup whose breaks are already in place — costs the walk
     * below and no query at all. On the commit path that matters: this runs on
     * every boundary.
     *
     * ## Written breaks are planted empty
     *
     * A talk break goes in as a `planned` segment with no script, and a job
     * writes it afterwards. The row and its place in the running order are one
     * cheap write each and both happen HERE, synchronously, because that is what
     * keeps this idempotent: the segment is in the order before the next commit
     * pass walks it, so that pass finds the gap filled and plants nothing. Only
     * the slow half is deferred, and a break that is never written is skipped by
     * the director exactly like one that was never rendered.
     */
    async plant(lineup: Lineup, rules: ResolvedRules): Promise<number> {
        if (!rules.breaks || rules.breakEveryItems <= 0) return 0;

        const positions = placementsFor(lineup.all(), lineup.cursor(), rules.breakEveryItems);
        if (positions.length === 0) return 0;

        // Both halves of being able to say something of the station's own: words to say, and a voice
        // to say them in. Without a speaker a written break could never be rendered and would be
        // skipped at every slot, which would cost the station the ident it could have had instead.
        const canWrite = this.writers.canWrite(TALK_BREAK_KIND) && this.speech.speaker() !== undefined;
        const idents = await this.segments.listReady(IDENT_KIND);

        if (!canWrite && idents.length === 0) {
            // Not a fault, and deliberately not a warning: a station with no idents recorded and
            // nothing able to write its own is an ordinary state, and it plays records. Said once
            // per pass at info, because an operator wondering why the station never says its own
            // name needs somewhere to look.
            this.logger.info('director: the lineup wants a break, but nothing can write one and the library holds no idents', {
                lineup: lineup.id,
            });
            return 0;
        }

        const placements = await this.fill(positions, idents, canWrite, await this.lastKindBefore(lineup, positions[0]!));
        if (placements.length === 0) return 0;

        const result = await lineup.insertSegments(placements.map(({ segmentId, atIndex }) => ({ segmentId, atIndex })));
        if (!result.ok) {
            // The order moved under the walk: the director committed, or an operator edited, between
            // computing these positions and writing them. Nothing is lost — the next pass walks the
            // order as it stands and plants against that.
            this.logger.info('director: a break placement was refused; it will be planned again', {
                lineup: lineup.id,
                reason: result.reason,
            });
            await this.abandon(placements);
            return 0;
        }

        // After the order is committed, and only for what actually went into it. A write job that
        // ran against a segment not yet in any running order would find no neighbours and write a
        // break about nothing.
        for (const placement of placements) {
            if (!placement.written) continue;
            await this.jobs.send('director.write_break', { lineupId: lineup.id, segmentId: placement.segmentId });
        }

        this.logger.info('director: planted breaks into a lineup', { lineup: lineup.id, count: placements.length, written: canWrite });
        return placements.length;
    }

    /**
     * One break per slot, alternating what sort each one is.
     *
     * A written break at one slot and a recorded ident at the next, which is what keeps the
     * station's own name in rotation instead of letting the DJ become the only voice on the
     * station. The alternation runs from the kind of the last segment ALREADY in the order rather
     * than restarting per pass, or a pass that plants one break at a time would plant the same kind
     * every time and never alternate at all.
     *
     * Availability wins over the alternation, in both directions: a station with no idents recorded
     * gets talk breaks at every slot, and one with no speaker gets idents at every slot. Neither
     * needs a branch anywhere else, and neither is worth skipping a break over.
     */
    private async fill(positions: readonly number[], idents: readonly Segment[], canWrite: boolean, lastKind: string | undefined): Promise<Placement[]> {
        const placements: Placement[] = [];
        let previousKind = lastKind;
        // Chosen per slot rather than once per pass, so two idents planted together are two
        // different recordings where the library has them.
        let previousIdent: string | undefined;

        for (const atIndex of positions) {
            const write = canWrite && (previousKind !== TALK_BREAK_KIND || idents.length === 0);

            if (write) {
                // A placeholder label. The writer replaces it with one naming the records it sits
                // between, at the same moment and by the same hand as the script.
                const segment = await this.segments.plan({ kind: TALK_BREAK_KIND, label: 'Talk break' });
                placements.push({ segmentId: segment.id, atIndex, written: true });
                previousKind = TALK_BREAK_KIND;
                continue;
            }

            const segment = choose(idents, previousIdent);
            previousIdent = segment.id;
            placements.push({ segmentId: segment.id, atIndex, written: false });
            previousKind = IDENT_KIND;
        }

        return placements;
    }

    /**
     * What sort of break the station last put in this order, before the first slot being filled.
     *
     * Costs one query, and only on a pass that is actually planting something — which is the rare
     * one. The lineup item names a segment by id and nothing else (`deadair.segments` is the single
     * truth for the rest), so the kind has to be read rather than remembered. A segment that has
     * since been deleted reads as no answer at all, which starts the alternation fresh.
     */
    private async lastKindBefore(lineup: Lineup, before: number): Promise<string | undefined> {
        const items = lineup.all();
        for (let index = Math.min(before, items.length) - 1; index >= 0; index--) {
            const item = items[index]!;
            if (item.kind !== 'segment') continue;

            const found = await this.segments.findByIds([item.segmentId]);
            return found.get(item.segmentId)?.kind;
        }
        return undefined;
    }

    /**
     * Rows planned for an order that then refused them.
     *
     * Failed rather than deleted, and rather than left `planned`. Left planned they would be picked
     * up by nothing and sit in the console's library looking like breaks that are still coming;
     * failed, they carry the reason and are inert. Rare by construction: it takes a commit or an
     * operator edit landing between the walk and the write.
     */
    private async abandon(placements: readonly Placement[]): Promise<void> {
        for (const placement of placements) {
            if (!placement.written) continue;
            await this.segments.markFailed(placement.segmentId, 'the running order moved before this break could be placed', 'planned');
        }
    }
}

/** One break, and where it goes. `written` distinguishes a row to write from an ident off the shelf. */
interface Placement {
    segmentId: string;
    atIndex: number;
    written: boolean;
}

/**
 * Where breaks belong in an order that already has some.
 *
 * Walks forward from the cursor counting records, and marks a slot whenever the
 * count reaches the spacing. A segment already in the order resets the count
 * rather than being counted, which is what makes this idempotent: run it twice
 * and the second walk sees the breaks the first one planted.
 *
 * The count starts from the last segment at or before the cursor rather than
 * from zero. Starting at zero would put a break `breakEveryItems` records after
 * whatever the station happens to be playing, so an app restarted mid-rotation
 * would talk again immediately after having just talked.
 *
 * Returns indices into the order as it stands, which is what
 * {@link Lineup.insertSegments} expects.
 */
function placementsFor(items: readonly LineupItem[], cursor: number, every: number): number[] {
    let since = recordsSinceLastSegment(items, cursor);
    const placements: number[] = [];

    for (let index = cursor; index < items.length; index++) {
        if (items[index]!.kind === 'segment') {
            since = 0;
            continue;
        }

        since += 1;
        if (since < every) continue;

        // After this record, not before it: the slot is the boundary the listener reaches once they
        // have heard `every` of them.
        const at = index + 1;

        // Never at the very end of the order, where a break would air after the last record rather
        // than between two of them. Nothing later in this walk can qualify either.
        if (at >= items.length) break;

        // Already a break here. Leave it alone and let the loop's own segment branch reset the
        // count when it reaches it: planting anyway is how a second pass over an order this has
        // already planted into doubles every one of them.
        if (items[at]!.kind === 'segment') continue;

        // Too close to the cursor to be programmed: that part of the order is about to be handed
        // over. Deliberately WITHOUT resetting the count, so the break lands at the first position
        // it legally can rather than a full interval later — it is already overdue, and pushing it
        // back again is how a station that was restarted goes quiet for twice as long as it should.
        if (at < cursor + PLANT_AHEAD) continue;

        placements.push(at);
        since = 0;
    }

    return placements;
}

/** How many records the station has played since it last said anything. */
function recordsSinceLastSegment(items: readonly LineupItem[], cursor: number): number {
    let count = 0;
    for (let index = cursor - 1; index >= 0; index--) {
        if (items[index]!.kind === 'segment') return count;
        count += 1;
    }
    return count;
}

/**
 * One segment for a slot, avoiding the one just used.
 *
 * Random rather than round-robin because the order the library happens to be in
 * is not a running order, and a station that always plays its three idents in the
 * same sequence sounds like a tape loop within an hour. Avoiding the previous one
 * is the only structure worth imposing: hearing the same ident twice running is
 * the one arrangement a listener actually notices.
 */
function choose(available: readonly Segment[], previous: string | undefined): Segment {
    const others = available.filter(segment => segment.id !== previous);
    const pool = others.length > 0 ? others : available;
    return pool[Math.floor(Math.random() * pool.length)]!;
}
