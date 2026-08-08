import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { SegmentRepository, type Segment } from '#modules/render/segment.repository.js';
import type { Lineup, LineupItem } from './lineup.js';
import type { ResolvedRules } from './rotation.rules.js';

/**
 * What kind of segment a break is, until the station has more than one sort to
 * choose from.
 *
 * A station ident is the thing every station does and the only thing this can
 * plant with no writer and no renderer behind it: the audio already exists,
 * because somebody recorded it and dropped it in. Talk breaks arrive as a second
 * kind here once something can write and speak them, and the choice of which
 * kind belongs at which slot becomes a rule rather than this constant.
 */
const BREAK_KIND = 'ident';

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
        private readonly logger: Logger,
    ) {}

    /**
     * Plant whatever breaks the tail is missing. Answers how many went in.
     *
     * Reads the library only when there is somewhere to put something, so the
     * ordinary case — a lineup whose breaks are already in place — costs the walk
     * below and no query at all. On the commit path that matters: this runs on
     * every boundary.
     */
    async plant(lineup: Lineup, rules: ResolvedRules): Promise<number> {
        if (!rules.breaks || rules.breakEveryItems <= 0) return 0;

        const positions = placementsFor(lineup.all(), lineup.cursor(), rules.breakEveryItems);
        if (positions.length === 0) return 0;

        const available = await this.segments.listReady(BREAK_KIND);
        if (available.length === 0) {
            // Not a fault, and deliberately not a warning: a station with no idents recorded yet is
            // an ordinary state, and it plays records. Said once per pass at info, because an
            // operator wondering why the station never says its own name needs somewhere to look.
            this.logger.info('director: the lineup wants a break but the library holds no idents', { lineup: lineup.id });
            return 0;
        }

        // Chosen per slot rather than once per pass, so three breaks planted together are three
        // different idents where the library has them.
        let previous: string | undefined;
        const placements = positions.map(atIndex => {
            const segment = choose(available, previous);
            previous = segment.id;
            return { segmentId: segment.id, atIndex };
        });

        const result = await lineup.insertSegments(placements);
        if (!result.ok) {
            // The order moved under the walk: the director committed, or an operator edited, between
            // computing these positions and writing them. Nothing is lost — the next pass walks the
            // order as it stands and plants against that.
            this.logger.info('director: a break placement was refused; it will be planned again', {
                lineup: lineup.id,
                reason: result.reason,
            });
            return 0;
        }

        this.logger.info('director: planted breaks into a lineup', { lineup: lineup.id, count: placements.length });
        return placements.length;
    }
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
