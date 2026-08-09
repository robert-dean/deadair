// Where a break belongs. Almost everything that can go wrong here is silent: a spacing counted off
// the wrong thing sounds like a station that talks too much, one that never plants sounds like a
// station that never says its own name, and one that plants on every pass fills the order with
// idents nobody asked for. So the arithmetic is pinned case by case.

import { Logger } from '@maroonedsoftware/logger';
import { describe, expect, it, vi } from 'vitest';

import { BreakPlanner, PLANT_AHEAD } from '../../../src/modules/director/break.planner.js';
import { Lineup } from '../../../src/modules/director/lineup.js';
import { resolveRules } from '../../../src/modules/director/rotation.rules.js';
import type { RundownTrack } from '../../../src/modules/playout/rundown.js';
import type { Segment, SegmentRepository } from '../../../src/modules/render/segment.repository.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const track = (externalId: string): RundownTrack => ({
    pluginId: 'deadair.spotify',
    externalId,
    title: `Track ${externalId}`,
    artists: ['An Artist'],
});

const ident = (id: string): Segment => ({ id, kind: 'ident', state: 'ready', label: `Ident ${id}`, source: 'library' });

/**
 * A planner with the two halves of talking switched off by default, so the cases below are about
 * WHERE a break goes rather than what it says. `canWrite` turns the written path on.
 */
const build = (options: { idents?: Segment[]; canWrite?: boolean; speaker?: boolean } = {}) => {
    const listReady = vi.fn(async () => options.idents ?? [ident('seg-1')]);
    let planned = 0;
    const plan = vi.fn(async (input: { kind: string; label: string }) => ({
        id: `planned-${++planned}`,
        state: 'planned',
        source: 'render',
        ...input,
    }));
    const markFailed = vi.fn(async () => {});

    const writers = { canWrite: vi.fn(() => options.canWrite ?? false) };
    const speech = { speaker: vi.fn(() => ((options.speaker ?? options.canWrite) ? { record: { id: 'deadair.kokoro' } } : undefined)) };
    const send = vi.fn(async () => {});

    return {
        planner: new BreakPlanner(
            { listReady, plan, markFailed } as unknown as SegmentRepository,
            writers as never,
            speech as never,
            { send } as never,
            logger,
        ),
        listReady,
        plan,
        markFailed,
        send,
    };
};

/** A rotation of `count` records, at a cursor, with nothing planted yet. */
const lineupOf = async (count: number, cursor = 0): Promise<Lineup> => {
    const lineup = new Lineup({ id: 'lineup-1', name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
    await lineup.append(Array.from({ length: count }, (_, index) => track(`t${index}`)));
    if (cursor > 0) await lineup.takeNext(cursor);
    return lineup;
};

/** Which lines are segments, by index. */
const segmentsAt = (lineup: Lineup): number[] =>
    lineup
        .all()
        .map((item, index) => (item.kind === 'segment' ? index : -1))
        .filter(index => index >= 0);

const rules = (overrides: Parameters<typeof resolveRules>[1] = {}) => resolveRules('rotation', overrides);

describe('BreakPlanner', () => {
    it('plants a break after every N records', async () => {
        const { planner } = build();
        const lineup = await lineupOf(20);

        await planner.plant(lineup, rules({ breakEveryItems: 4 }));

        // After the 4th, 8th, 12th and 16th record, with each earlier break shifting the ones
        // behind it by one. Nothing lands after the last record: a break there airs into whatever
        // follows the lineup rather than between two of its own lines.
        expect(segmentsAt(lineup)).toEqual([4, 9, 14, 19]);
    });

    // The property that makes it safe to call from the commit pass, which runs on every boundary.
    it('plants nothing on a second pass over an order it has just planted into', async () => {
        const { planner } = build();
        const lineup = await lineupOf(20);
        await planner.plant(lineup, rules({ breakEveryItems: 4 }));
        const after = segmentsAt(lineup);

        expect(await planner.plant(lineup, rules({ breakEveryItems: 4 }))).toBe(0);
        expect(segmentsAt(lineup)).toEqual(after);
    });

    // Counting from zero would have a station restarted mid-rotation talk again immediately after
    // it had just talked.
    it('counts from the last segment already aired, not from the cursor', async () => {
        const { planner } = build();
        const lineup = await lineupOf(20);
        // A break two records back, both of them already committed.
        await lineup.insertSegment('seg-old', 3);
        await lineup.takeNext(6);

        await planner.plant(lineup, rules({ breakEveryItems: 4 }));

        // Two records have aired since that break, so the next one is due two records further on
        // rather than four — but that slot is inside the window about to be handed over, so it
        // lands at the first position it legally can instead of being pushed a whole interval back.
        expect(segmentsAt(lineup).filter(index => index > 6)[0]).toBe(6 + PLANT_AHEAD);
    });

    // Segments are not what a listener is counting. They are counting songs since they last heard
    // the station's name.
    it('does not count a segment toward the spacing', async () => {
        const { planner } = build();
        const lineup = await lineupOf(12);
        await lineup.insertSegment('seg-other', 2);

        await planner.plant(lineup, rules({ breakEveryItems: 4 }));

        // Records at 0 and 1, the segment at 2, then records at 3,4,5,6. Four RECORDS after the
        // segment ends at index 6, so the next break goes at 7. Counting the segment itself would
        // have put it at 5.
        expect(segmentsAt(lineup)).toContain(7);
    });

    it('never plants into what the director is about to hand over', async () => {
        const { planner } = build();
        const lineup = await lineupOf(20, 8);

        await planner.plant(lineup, rules({ breakEveryItems: 1 }));

        for (const index of segmentsAt(lineup)) expect(index).toBeGreaterThanOrEqual(8 + PLANT_AHEAD);
    });

    it('refuses to touch a lineup whose rules say no breaks', async () => {
        const { planner, listReady } = build();
        const lineup = await lineupOf(20);

        expect(await planner.plant(lineup, resolveRules('setlist'))).toBe(0);
        expect(segmentsAt(lineup)).toEqual([]);
        expect(listReady).not.toHaveBeenCalled();
    });

    it('treats a spacing of zero as no breaks at all', async () => {
        const { planner } = build();
        const lineup = await lineupOf(20);

        expect(await planner.plant(lineup, rules({ breakEveryItems: 0 }))).toBe(0);
    });

    // The ordinary case on the commit path is a lineup whose breaks are already in place, and it
    // has to cost nothing: this runs on every track boundary.
    it('does not read the library when there is nowhere to put anything', async () => {
        const { planner, listReady } = build();
        const lineup = await lineupOf(2);

        await planner.plant(lineup, rules({ breakEveryItems: 4 }));

        expect(listReady).not.toHaveBeenCalled();
    });

    // A station with nothing recorded yet is an ordinary state. It plays records.
    it('carries on when the library holds no idents', async () => {
        const { planner } = build({ idents: [] });
        const lineup = await lineupOf(20);

        expect(await planner.plant(lineup, rules({ breakEveryItems: 4 }))).toBe(0);
        expect(segmentsAt(lineup)).toEqual([]);
    });

    // Hearing the same ident twice running is the one arrangement a listener actually notices.
    it('does not use the same ident twice in a row', async () => {
        const { planner } = build({ idents: [ident('a'), ident('b')] });
        const lineup = await lineupOf(20);

        await planner.plant(lineup, rules({ breakEveryItems: 4 }));

        const used = lineup.all().flatMap(item => (item.kind === 'segment' ? [item.segmentId] : []));
        for (let index = 1; index < used.length; index++) expect(used[index]).not.toBe(used[index - 1]);
    });

    it('has nothing else to choose from when the library holds one ident', async () => {
        const { planner } = build({ idents: [ident('only')] });
        const lineup = await lineupOf(12);

        await planner.plant(lineup, rules({ breakEveryItems: 4 }));

        expect(lineup.all().filter(item => item.kind === 'segment')).not.toHaveLength(0);
    });

    it('writes the whole batch once rather than once per break', async () => {
        const { planner } = build();
        const lineup = await lineupOf(20);
        const before = lineup.revision();

        await planner.plant(lineup, rules({ breakEveryItems: 4 }));

        // Four breaks, one revision. Four separate edits would rewrite the order four times and
        // invalidate an operator's in-flight edit four times over.
        expect(lineup.revision()).toBe(before + 1);
    });
});

// The half that makes the station a station rather than a shuffle. A written break is planted with
// no words in it: the row and its place in the order go down here, synchronously, and a job writes
// the script behind them.
describe('BreakPlanner writing its own breaks', () => {
    it('plants empty talk breaks and sends a job to write each one', async () => {
        const { planner, plan, send, listReady } = build({ canWrite: true });
        const lineup = await lineupOf(12);

        await planner.plant(lineup, rules({ breakEveryItems: 4 }));

        // Two slots in twelve records, so two rows and two jobs, and no reach for the ident shelf.
        expect(plan).toHaveBeenCalledTimes(2);
        expect(plan).toHaveBeenCalledWith(expect.objectContaining({ kind: 'talkbreak' }));
        expect(plan.mock.calls.every(([input]) => input.script === undefined)).toBe(true);
        expect(send).toHaveBeenCalledTimes(2);
        expect(send).toHaveBeenCalledWith('director.write_break', { lineupId: 'lineup-1', segmentId: 'planned-1' });
        expect(listReady).not.toHaveBeenCalled();
    });

    it('plants one row per slot, because two breaks sit between different records', async () => {
        const { planner } = build({ canWrite: true });
        const lineup = await lineupOf(12);

        await planner.plant(lineup, rules({ breakEveryItems: 4 }));

        const used = lineup.all().flatMap(item => (item.kind === 'segment' ? [item.segmentId] : []));
        expect(new Set(used).size).toBe(used.length);
    });

    // The property the whole design rests on: planting stays idempotent even though the words arrive
    // later, because the row is in the order before the next commit pass walks it.
    it('plants nothing on a second pass, even though the first pass wrote no scripts', async () => {
        const { planner, plan } = build({ canWrite: true });
        const lineup = await lineupOf(12);
        await planner.plant(lineup, rules({ breakEveryItems: 4 }));

        expect(await planner.plant(lineup, rules({ breakEveryItems: 4 }))).toBe(0);
        expect(plan).toHaveBeenCalledTimes(2);
    });

    it('falls back to recorded idents when nothing can write', async () => {
        const { planner, plan, listReady, send } = build({ canWrite: false });
        const lineup = await lineupOf(12);

        await planner.plant(lineup, rules({ breakEveryItems: 4 }));

        expect(listReady).toHaveBeenCalledWith('ident');
        expect(plan).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    it('falls back to recorded idents when there is nothing to say them in', async () => {
        // Words with no voice is a break that could never be rendered, so it would be skipped at
        // every slot — costing the station the ident it could have aired instead.
        const { planner, plan, listReady } = build({ canWrite: true, speaker: false });
        const lineup = await lineupOf(12);

        await planner.plant(lineup, rules({ breakEveryItems: 4 }));

        expect(listReady).toHaveBeenCalledWith('ident');
        expect(plan).not.toHaveBeenCalled();
    });

    it('fails the rows it planned when the order refuses them, rather than leaving them looking pending', async () => {
        const { planner, markFailed, send } = build({ canWrite: true });
        const lineup = await lineupOf(12);
        // A stale revision is what a commit or an operator edit landing mid-walk looks like here.
        vi.spyOn(lineup, 'insertSegments').mockResolvedValue({ ok: false, reason: 'stale' } as never);

        expect(await planner.plant(lineup, rules({ breakEveryItems: 4 }))).toBe(0);
        expect(markFailed).toHaveBeenCalledTimes(2);
        expect(markFailed).toHaveBeenCalledWith('planned-1', expect.stringContaining('moved'), 'planned');
        expect(send).not.toHaveBeenCalled();
    });
});
