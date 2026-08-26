// Where a break belongs. Almost everything that can go wrong here is silent: a spacing counted off
// the wrong thing sounds like a station that talks too much, one that never plants sounds like a
// station that never says its own name, and one that plants on every pass fills the order with
// idents nobody asked for. So the arithmetic is pinned case by case.

import { Logger } from '@maroonedsoftware/logger';
import { describe, expect, it, vi } from 'vitest';

import { BreakPlanner, INTERRUPT_OVER_AT_MS, PLANT_AHEAD, WRITE_AHEAD, type AirClock } from '../../../src/modules/director/break.planner.js';
import type { StoredBreakRequest } from '../../../src/modules/director/break.request.js';
import type { ClockBand } from '../../../src/modules/director/clock.bands.js';
import { TALK_BREAK_KIND } from '../../../src/modules/director/talk.break.writer.js';
import { WELCOME_KIND } from '../../../src/modules/director/welcome.writer.js';
import { settingsConfig } from '../../utils/settings.config.js';
import { StationLineup } from '../../../src/modules/director/station.lineup.js';
import { resolveRules } from '../../../src/modules/director/rotation.rules.js';
import type { RundownTrack } from '../../../src/modules/playout/rundown.js';
import type { PlannedSegment, Segment, SegmentRepository } from '../../../src/modules/render/segment.repository.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

/**
 * How long every record in these fixtures runs.
 *
 * Spacing is minutes of airtime now, so a case that wants to say "a break every four records" says
 * `4 * TRACK_MINUTES` and stays readable as the count it is really about. Five is round and is not
 * the planner's own fallback for an unmeasured record, so a test that accidentally dropped the
 * duration would come out at a different interval rather than silently agreeing.
 */
const TRACK_MINUTES = 5;

const track = (externalId: string): RundownTrack => ({
    pluginId: 'deadair.spotify',
    externalId,
    title: `Track ${externalId}`,
    artists: ['An Artist'],
    artist: 'An Artist',
    durationMs: TRACK_MINUTES * 60_000,
});

/**
 * Where the station is against the wall clock.
 *
 * Nothing airing by default, so the projection starts at the head of the order and the cases that
 * are only about spacing need not think about a clock at all. A case testing an anchored band
 * passes its own `now`.
 */
const clock = (now = Date.UTC(2026, 7, 13, 9, 0), from = 0): AirClock => ({ now, anchorAt: now, from });

const recorded = (id: string, kind: string): Segment => ({ id, kind, state: 'ready', label: `${kind} ${id}`, source: 'library', pads: [] });
const ident = (id: string): Segment => recorded(id, 'ident');

/**
 * A planner with the two halves of talking switched off by default, so the cases below are about
 * WHERE a break goes rather than what it says. `canWrite` turns the written path on.
 */
const build = (
    options: { idents?: Segment[]; canWrite?: boolean; speaker?: boolean; settings?: Record<string, string>; bands?: ClockBand[] } = {},
) => {
    // Answers for the KIND it was asked about, the way the repository does. A blanket answer would
    // have a band for `news` quietly filled with an ident and every case below pass for the wrong
    // reason.
    const listReady = vi.fn(async (kind: string) => (options.idents ?? [ident('seg-1')]).filter(segment => segment.kind === kind));
    let planned = 0;
    // What the alternation and the write window both read: a lineup item names a segment by id, so
    // anything about it — its kind, whether anybody has written it — is a lookup rather than a
    // memory. Planted rows go in here too, which is what lets `ripen` see them.
    const known = new Map<string, Segment>((options.idents ?? [ident('seg-1')]).map(segment => [segment.id, segment]));
    /** When each row last moved, standing in for the `updated_at` the database keeps by trigger. */
    const touched = new Map<string, number>();
    const plan = vi.fn(async (input: PlannedSegment) => {
        const segment = { id: `planned-${++planned}`, state: 'planned', source: 'render', ...input } as Segment;
        known.set(segment.id, segment);
        return segment;
    });
    const markFailed = vi.fn(async () => {});
    const findByIds = vi.fn(async (ids: readonly string[]) => new Map([...known].filter(([id]) => ids.includes(id))));
    // The SQL's own state guard, mirrored: `writing` and `rendering` are a job's claim and are never
    // reset underneath one. Kept here rather than in the planner for exactly that reason — one rule,
    // one place — so a case about a claimed row is really testing the rule the database enforces.
    const reopenSegments = vi.fn(async (ids: readonly string[]) => {
        const reopened: string[] = [];
        for (const id of ids) {
            const segment = known.get(id);
            if (segment === undefined || !['planned', 'written', 'ready'].includes(segment.state)) continue;

            const { script, writer, claimsItemId, claimsTime, ...rest } = segment;
            known.set(id, { ...rest, state: 'planned' });
            reopened.push(id);
        }
        return reopened;
    });

    // The other half of the SQL, mirrored: a row is handed back only when its claim is older than
    // the caller's bound, and `rendering` goes back to `written` only when the words are on it.
    // `touched` stands in for `updated_at`, which the database maintains by trigger.
    const releaseStranded = vi.fn(async (ids: readonly string[], before: { writing: number; rendering: number }) => {
        const released: { writing: string[]; rendering: string[] } = { writing: [], rendering: [] };
        for (const id of ids) {
            const segment = known.get(id);
            const at = touched.get(id) ?? Date.now();
            if (segment?.state === 'writing' && at < before.writing) {
                known.set(id, { ...segment, state: 'planned' });
                released.writing.push(id);
            }
            if (segment?.state === 'rendering' && at < before.rendering && segment.script !== undefined) {
                known.set(id, { ...segment, state: 'written' });
                released.rendering.push(id);
            }
        }
        return released;
    });

    // Failures counted the way the SQL counts them, off a row's own history rather than a column.
    const failures = new Map<string, number>();
    const failedWithScript = vi.fn(async (ids: readonly string[]) =>
        ids.flatMap(id => {
            const segment = known.get(id);
            return segment?.state === 'failed' && segment.script !== undefined ? [{ id, failures: failures.get(id) ?? 1 }] : [];
        }),
    );

    // The format clock, as the rows the planner is handed. Only `active` is reached from here: a
    // band that is switched off never leaves the repository.
    const clockBands = { active: vi.fn(async () => options.bands ?? []) };
    const writers = { canWrite: vi.fn(() => options.canWrite ?? false) };
    const speech = { speaker: vi.fn(() => ((options.speaker ?? options.canWrite) ? { record: { id: 'deadair.kokoro' } } : undefined)) };
    const send = vi.fn(async () => {});

    return {
        planner: new BreakPlanner(
            { listReady, plan, markFailed, findByIds, reopenSegments, releaseStranded, failedWithScript } as unknown as SegmentRepository,
            writers as never,
            speech as never,
            clockBands as never,
            { send } as never,
            settingsConfig(options.settings ?? {}).config,
            logger,
        ),
        listReady,
        plan,
        markFailed,
        reopenSegments,
        releaseStranded,
        failedWithScript,
        send,
        known,
        touched,
        failures,
    };
};

/** Hand the first `count` planned items over, the way a commit pass does. */
const hand = (lineup: StationLineup, count: number): void => {
    for (const item of lineup.nextPlanned(count)) lineup.markHanded(item.id);
};

/** A rotation of `count` records, `committed` of them already with the player, nothing planted yet. */
const lineupOf = async (count: number, committed = 0): Promise<StationLineup> => {
    const lineup = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
    lineup.append(Array.from({ length: count }, (_, index) => track(`t${index}`)));
    if (committed > 0) hand(lineup, committed);
    return lineup;
};

/** Which lines are segments, by index. */
const segmentsAt = (lineup: StationLineup): number[] =>
    lineup
        .all()
        .map((item, index) => (item.kind === 'segment' ? index : -1))
        .filter(index => index >= 0);

const rules = (overrides: Parameters<typeof resolveRules>[1] = {}) => resolveRules('rotation', overrides);

describe('BreakPlanner', () => {
    it('plants a break after every N records', async () => {
        const { planner } = build();
        const lineup = await lineupOf(20);

        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());

        // After the 4th, 8th, 12th and 16th record, with each earlier break shifting the ones
        // behind it by one. Nothing lands after the last record: a break there airs into whatever
        // follows the lineup rather than between two of its own lines.
        expect(segmentsAt(lineup)).toEqual([4, 9, 14, 19]);
    });

    // The bug this pairs with is in `StationLineup.remove`: a spliced-out break left a gap the
    // walk could not tell from one that was never planted into, so the break came back a
    // boundary later. The cut is a `removed` segment now, and the walk reads it like any other
    // segment already in the order — the state matters to the console and to the head, not here.
    it('does not plant a break back into a slot the operator has just cleared', async () => {
        const { planner } = build();
        const lineup = await lineupOf(20);
        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());

        const removed = lineup.all()[9]!;
        expect(lineup.remove(removed.id)).toEqual({ ok: true });

        expect(await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock())).toBe(0);
        expect(segmentsAt(lineup)).toEqual([4, 9, 14, 19]);
        expect(lineup.all()[9]!.state).toBe('removed');
    });

    // The property that makes it safe to call from the commit pass, which runs on every boundary.
    it('plants nothing on a second pass over an order it has just planted into', async () => {
        const { planner } = build();
        const lineup = await lineupOf(20);
        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());
        const after = segmentsAt(lineup);

        expect(await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock())).toBe(0);
        expect(segmentsAt(lineup)).toEqual(after);
    });

    // Counting from zero would have a station restarted mid-rotation talk again immediately after
    // it had just talked.
    it('counts from the last segment already aired, not from the cursor', async () => {
        const { planner } = build();
        const lineup = await lineupOf(20);
        // A break two records back, both of them already committed.
        lineup.insertSegment('seg-old', 3);
        hand(lineup, 6);

        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());

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
        lineup.insertSegment('seg-other', 2);

        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());

        // Records at 0 and 1, the segment at 2, then records at 3,4,5,6. Four RECORDS after the
        // segment ends at index 6, so the next break goes at 7. Counting the segment itself would
        // have put it at 5.
        expect(segmentsAt(lineup)).toContain(7);
    });

    // Spacing is per kind, which is the whole reason the order carries one. These two are the same
    // assertion from both sides, and getting either wrong is inaudible until an hour has gone by
    // with the station never naming itself, or naming itself twice as often as asked.
    it('does not let a break of another kind reset the station rule', async () => {
        const { planner } = build();
        const lineup = await lineupOf(12);
        // A bulletin two records in. It is the station talking, but it is not the station saying
        // which station it is, so the listener is no better off knowing what they are listening to.
        lineup.insertSegment('news-1', 2, undefined, 'news');

        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());

        // Four records of airtime from the top, so the first station break falls after the record
        // at index 4 — the bulletin having cost it nothing. If the bulletin had reset the count it
        // would be two records further on, at 7.
        expect(segmentsAt(lineup)).toContain(5);
        expect(segmentsAt(lineup)).not.toContain(7);
    });

    it('counts a break with no kind as the station, because that is all an older order holds', async () => {
        const { planner } = build();
        const lineup = await lineupOf(12);
        lineup.insertSegment('seg-old', 2);

        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());

        // The unlabelled break DOES reset it, so the next one is four records past index 2.
        expect(segmentsAt(lineup)).toContain(7);
        expect(segmentsAt(lineup)).not.toContain(5);
    });

    it('never plants into what the director is about to hand over', async () => {
        const { planner } = build();
        const lineup = await lineupOf(20, 8);

        await planner.plant(lineup, rules({ breakEveryMinutes: 1 * TRACK_MINUTES }), clock());

        for (const index of segmentsAt(lineup)) expect(index).toBeGreaterThanOrEqual(8 + PLANT_AHEAD);
    });

    it('refuses to touch a lineup whose rules say no breaks', async () => {
        const { planner, listReady } = build();
        const lineup = await lineupOf(20);

        expect(await planner.plant(lineup, resolveRules('setlist'), clock())).toBe(0);
        expect(segmentsAt(lineup)).toEqual([]);
        expect(listReady).not.toHaveBeenCalled();
    });

    it('treats a spacing of zero as no breaks at all', async () => {
        const { planner } = build();
        const lineup = await lineupOf(20);

        expect(await planner.plant(lineup, rules({ breakEveryMinutes: 0 }), clock())).toBe(0);
    });

    // The ordinary case on the commit path is a lineup whose breaks are already in place, and it
    // has to cost nothing: this runs on every track boundary.
    it('does not read the library when there is nowhere to put anything', async () => {
        const { planner, listReady } = build();
        const lineup = await lineupOf(2);

        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());

        expect(listReady).not.toHaveBeenCalled();
    });

    // A station with nothing recorded yet is an ordinary state. It plays records.
    it('carries on when the library holds no idents', async () => {
        const { planner } = build({ idents: [] });
        const lineup = await lineupOf(20);

        expect(await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock())).toBe(0);
        expect(segmentsAt(lineup)).toEqual([]);
    });

    // Hearing the same ident twice running is the one arrangement a listener actually notices.
    it('does not use the same ident twice in a row', async () => {
        const { planner } = build({ idents: [ident('a'), ident('b')] });
        const lineup = await lineupOf(20);

        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());

        const used = lineup.all().flatMap(item => (item.kind === 'segment' ? [item.segmentId] : []));
        for (let index = 1; index < used.length; index++) expect(used[index]).not.toBe(used[index - 1]);
    });

    it('has nothing else to choose from when the library holds one ident', async () => {
        const { planner } = build({ idents: [ident('only')] });
        const lineup = await lineupOf(12);

        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());

        expect(lineup.all().filter(item => item.kind === 'segment')).not.toHaveLength(0);
    });

    it('puts the whole batch in with one edit rather than one per break', async () => {
        const { planner } = build();
        const lineup = await lineupOf(20);
        const insert = vi.spyOn(lineup, 'insertSegments');

        const planted = await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());

        // Four breaks, one edit. Applying them one at a time would make every placement after
        // the first mean something different from what the walk computed, since each insert
        // shifts the indices behind it.
        expect(planted).toBe(4);
        expect(insert).toHaveBeenCalledTimes(1);
        expect(insert.mock.calls[0]![0]).toHaveLength(4);
    });
});

// The half that makes the station a station rather than a shuffle. A written break is planted with
// no words in it: the row and its place in the order go down here, synchronously, and a job writes
// the script behind them.
describe('BreakPlanner writing its own breaks', () => {
    it('plants an empty talk break, and asks nobody to write it yet', async () => {
        const { planner, plan, send } = build({ canWrite: true });
        const lineup = await lineupOf(12);

        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());

        expect(plan).toHaveBeenCalledWith(expect.objectContaining({ kind: 'talkbreak' }));
        // Planted with no words in it: `ripen` asks for them once the slot is near, and the job
        // fills them in behind the placement.
        expect(plan.mock.calls.every(([input]) => input.script === undefined)).toBe(true);
        expect(send).not.toHaveBeenCalled();
    });

    it('plants one row per written slot, because two breaks sit between different records', async () => {
        const { planner } = build({ canWrite: true });
        const lineup = await lineupOf(20);

        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());

        const written = lineup.all().flatMap(item => (item.kind === 'segment' && item.segmentId.startsWith('planned-') ? [item.segmentId] : []));
        expect(new Set(written).size).toBe(written.length);
    });

    // The property the whole design rests on: planting stays idempotent even though the words arrive
    // later, because the row is in the order before the next commit pass walks it.
    it('plants nothing on a second pass, even though the first pass wrote no scripts', async () => {
        const { planner, plan } = build({ canWrite: true });
        const lineup = await lineupOf(12);
        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());
        const planted = plan.mock.calls.length;

        expect(await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock())).toBe(0);
        expect(plan).toHaveBeenCalledTimes(planted);
    });

    it('falls back to recorded idents when nothing can write', async () => {
        const { planner, plan, listReady, send } = build({ canWrite: false });
        const lineup = await lineupOf(12);

        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());

        expect(listReady).toHaveBeenCalledWith('ident');
        expect(plan).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    it('falls back to recorded idents when there is nothing to say them in', async () => {
        // Words with no voice is a break that could never be rendered, so it would be skipped at
        // every slot — costing the station the ident it could have aired instead.
        const { planner, plan, listReady } = build({ canWrite: true, speaker: false });
        const lineup = await lineupOf(12);

        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());

        expect(listReady).toHaveBeenCalledWith('ident');
        expect(plan).not.toHaveBeenCalled();
    });

    it('fails the rows it planned when the order refuses them, rather than leaving them looking pending', async () => {
        const { planner, markFailed, send } = build({ canWrite: true });
        const lineup = await lineupOf(12);
        // A stale revision is what a commit or an operator edit landing mid-walk looks like here.
        vi.spyOn(lineup, 'insertSegments').mockResolvedValue({ ok: false, reason: 'stale' } as never);

        expect(await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock())).toBe(0);
        expect(markFailed).toHaveBeenCalledWith('planned-1', expect.stringContaining('moved'), 'planned');
        expect(send).not.toHaveBeenCalled();
    });
});

// A written break at one slot and a recorded ident at the next, so the DJ does not become the only
// voice on the station and the station's own name stays in rotation.
describe('BreakPlanner alternating what a break is', () => {
    /** Which kind landed at each segment position, in order. */
    const kindsPlanted = (lineup: StationLineup): string[] =>
        lineup.all().flatMap(item => (item.kind === 'segment' ? [item.segmentId.startsWith('planned-') ? 'talkbreak' : 'ident'] : []));

    it('alternates written breaks with recorded idents', async () => {
        const { planner } = build({ canWrite: true, idents: [ident('a'), ident('b')] });
        const lineup = await lineupOf(20);

        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());

        expect(kindsPlanted(lineup)).toEqual(['talkbreak', 'ident', 'talkbreak', 'ident']);
    });

    // Without this a pass that plants a single break would start from the same kind every time and
    // never alternate at all, which is exactly what the commit path does on a lineup already in flight.
    it('carries the alternation on from the last break already in the order', async () => {
        const { planner } = build({ canWrite: true });
        const lineup = await lineupOf(20);
        // One break at a time, the way the commit pass plants as the cursor advances.
        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());
        hand(lineup, 6);
        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());

        const kinds = kindsPlanted(lineup);
        for (let index = 1; index < kinds.length; index++) expect(kinds[index]).not.toBe(kinds[index - 1]);
    });

    it('plants talk breaks at every slot when the library holds no idents', async () => {
        const { planner } = build({ canWrite: true, idents: [] });
        const lineup = await lineupOf(20);

        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());

        expect(new Set(kindsPlanted(lineup))).toEqual(new Set(['talkbreak']));
    });

    it('plants idents at every slot when nothing can write', async () => {
        const { planner } = build({ canWrite: false, idents: [ident('a'), ident('b')] });
        const lineup = await lineupOf(20);

        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());

        expect(new Set(kindsPlanted(lineup))).toEqual(new Set(['ident']));
    });
});

// The write window. Planting lays a break's POSITION down as far ahead as the order runs; this is
// what decides when the station pays for its WORDS. The whole point is that the two are different
// distances: an hour of forward planning must not mean an hour of model and speech work that an
// operator edit can throw away.
// A band is the station saying something at a time rather than after a count, so every case here is
// about WHICH boundary it lands on. Landing late is designed for and absorbed by the vague phrasing;
// landing early is the one failure the words cannot cover, so it is pinned from both sides.
describe('BreakPlanner against the clock', () => {
    /** Nine o'clock, with the station eight minutes into the record at the head of the order. */
    const eightPastNine = (): AirClock => ({
        now: Date.UTC(2026, 7, 13, 9, 8),
        anchorAt: Date.UTC(2026, 7, 13, 9, 0),
        from: 0,
    });

    /** The station's own clock, in UTC so a boundary in a test is the boundary it reads as. */
    const utc = (): Record<string, string> => ({ 'station.timezone': 'UTC' });
    const at = (minute: number, kind: string, hour?: number): ClockBand => ({ at: 'clock', minute, kind, ...(hour === undefined ? {} : { hour }) });

    it('plants a band at the first boundary at or after its time, never before it', async () => {
        const { planner, plan } = build({ settings: utc(), bands: [at(30, 'news')], canWrite: true });
        const lineup = await lineupOf(20);

        await planner.plant(lineup, rules({ breaks: true, breakEveryMinutes: 0 }), eightPastNine());

        // Records are five minutes and the head one started at 09:00, so boundaries fall at 09:05,
        // 09:10 ... The first at or after 09:30 is index 6. Index 5 is 09:25 and would have the
        // station say "coming up to half past" at twenty-five past, which is the lie.
        const planted = segmentsAt(lineup);
        expect(planted).toEqual([6]);
        expect(plan).toHaveBeenCalledWith(expect.objectContaining({ kind: 'news' }));
    });

    it('stamps what a band is about on the row it plants, and names the break for it', async () => {
        // The subject has to survive to a job that runs several passes later, and nothing recomputes
        // the clock in between — so it rides the row, as the airs-at does, and as the KEY rather
        // than the id because that is what the writer for the kind reads.
        const technology = { id: 'topic-1', key: 'technology', label: 'Technology' };
        const { planner, plan } = build({ settings: utc(), bands: [{ ...at(30, 'news'), topic: technology }], canWrite: true });
        const lineup = await lineupOf(20);

        await planner.plant(lineup, rules({ breaks: true, breakEveryMinutes: 0 }), eightPastNine());

        expect(plan).toHaveBeenCalledWith(expect.objectContaining({ kind: 'news', label: 'Technology news', context: { topic: 'technology' } }));
    });

    it('plants no context for a band that is about nothing, which is most of them', async () => {
        const { planner, plan } = build({ settings: utc(), bands: [at(30, 'news')], canWrite: true });
        const lineup = await lineupOf(20);

        await planner.plant(lineup, rules({ breaks: true, breakEveryMinutes: 0 }), eightPastNine());

        expect(plan).toHaveBeenCalledWith(expect.not.objectContaining({ context: expect.anything() }));
    });

    it('leaves a band alone once its boundary already holds a break', async () => {
        const { planner } = build({ settings: utc(), bands: [at(30, 'news')] });
        const lineup = await lineupOf(20);

        await planner.plant(lineup, rules({ breaks: true, breakEveryMinutes: 0 }), eightPastNine());
        const after = segmentsAt(lineup);

        expect(await planner.plant(lineup, rules({ breaks: true, breakEveryMinutes: 0 }), eightPastNine())).toBe(0);
        expect(segmentsAt(lineup)).toEqual(after);
    });

    it('drops an occurrence whose boundary is inside the window the player already holds', async () => {
        const { planner } = build({ settings: utc(), bands: [at(30, 'news')] });
        // Eight records handed over, so everything before index 12 is out of reach. Half past falls
        // at index 6, well inside it.
        const lineup = await lineupOf(20, 8);

        await planner.plant(lineup, rules({ breaks: true, breakEveryMinutes: 0 }), eightPastNine());

        // Not planted late to make up for it: a bulletin at ten to ten is not the half-past
        // bulletin, and the next occurrence is an hour away.
        expect(segmentsAt(lineup)).toEqual([]);
    });

    it('plants nothing when the order does not reach the band yet', async () => {
        const { planner } = build({ settings: utc(), bands: [at(0, 'news', 3)] });
        const lineup = await lineupOf(20);

        // Eighteen hours out against an order holding a hundred minutes. A later pass asks again.
        expect(await planner.plant(lineup, rules({ breaks: true, breakEveryMinutes: 0 }), eightPastNine())).toBe(0);
    });

    it('takes an anchored rule before a spacing one when both want the same boundary', async () => {
        const { planner } = build({ settings: utc(), bands: [at(30, 'news')], idents: [ident('seg-1'), recorded('news-1', 'news')] });
        const lineup = await lineupOf(20);

        // The station's own spacing is thirty minutes, so it wants index 6 too. The anchored rule
        // is the one that cannot move, so it takes it and the spacing rule goes on to the next.
        await planner.plant(lineup, rules({ breaks: true, breakEveryMinutes: 30 }), eightPastNine());

        const kinds = lineup.all().flatMap(item => (item.kind === 'segment' ? [item.segmentKind] : []));
        expect(kinds[0]).toBe('news');
        expect(segmentsAt(lineup)[0]).toBe(6);
    });

    it('does not let a bulletin it just planted stand in for the station naming itself', async () => {
        const { planner } = build({ settings: utc(), bands: [at(30, 'news')], idents: [ident('seg-1'), recorded('news-1', 'news')] });
        const lineup = await lineupOf(20);

        await planner.plant(lineup, rules({ breaks: true, breakEveryMinutes: 30 }), eightPastNine());

        // The station rule is unaffected by the news at index 6 and still plants its own break six
        // records in, which after the bulletin shifted things is index 7.
        const kinds = lineup.all().flatMap(item => (item.kind === 'segment' ? [item.segmentKind] : []));
        expect(kinds).toContain('ident');
    });

    it('says so once and plants nothing when the clock names a break nothing can produce', async () => {
        const { planner, plan } = build({ settings: utc(), bands: [at(30, 'weather')], idents: [ident('seg-1')] });
        const lineup = await lineupOf(20);

        await planner.plant(lineup, rules({ breaks: true, breakEveryMinutes: 0 }), eightPastNine());

        // No writer for `weather` and no recordings of one, so the slot goes unfilled rather than
        // being filled with something else the operator did not ask for.
        expect(segmentsAt(lineup)).toEqual([]);
        expect(plan).not.toHaveBeenCalled();
    });

    it('fills a band from the shelf when the library holds a recording of that kind', async () => {
        const { planner } = build({ settings: utc(), bands: [at(30, 'sponsor')], idents: [recorded('spot-1', 'sponsor')] });
        const lineup = await lineupOf(20);

        // `segments.kind` is free text on purpose: a station that wants sponsor spots drops the
        // recordings in and writes one line, with no migration and no code.
        await planner.plant(lineup, rules({ breaks: true, breakEveryMinutes: 0 }), eightPastNine());

        const kinds = lineup.all().flatMap(item => (item.kind === 'segment' ? [item.segmentKind] : []));
        expect(kinds).toEqual(['sponsor']);
    });

    it('leaves a band whose time is not in reach and still fills the rest of the clock', async () => {
        // Nine o'clock has gone by, so that band's next occurrence is tomorrow and the order does
        // not reach it. A rule that cannot be placed must cost the rules beside it nothing.
        const { planner } = build({ settings: utc(), bands: [at(0, 'news', 9), at(30, 'sponsor')], idents: [recorded('spot-1', 'sponsor')] });
        const lineup = await lineupOf(20);

        await planner.plant(lineup, rules({ breaks: true, breakEveryMinutes: 0 }), eightPastNine());

        expect(segmentsAt(lineup)).toEqual([6]);
    });

    // The bug the whole feature existed for, found by running it rather than by reading it. A band
    // naming `talkbreak` — which is what somebody writes for a top-of-the-hour station ID, the
    // headline reason to have a clock at all — fell through to the station's own alternation. It
    // came out as an ordinary break carrying no time, and half the time came out as an ident
    // instead, so the one break that was supposed to say the hour never said anything of the sort.
    // Every other case here named `news` or `sponsor` and sailed straight past it.
    it('gives a band naming talkbreak its time, instead of handing it to the alternation', async () => {
        const { planner, plan } = build({ settings: utc(), bands: [at(30, 'talkbreak')], canWrite: true, idents: [ident('seg-1')] });
        const lineup = await lineupOf(20);

        await planner.plant(lineup, rules({ breaks: true, breakEveryMinutes: 0 }), eightPastNine());

        expect(plan).toHaveBeenCalledWith(expect.objectContaining({ kind: 'talkbreak', airsAt: expect.any(Number) }));
    });

    it('fills a band with the kind named, never with whatever the alternation was due', async () => {
        // Idents available and a talk break just planted would ordinarily make the next one an
        // ident. A band is not the station taking its turn, so it gets what it asked for.
        const { planner } = build({ settings: utc(), bands: [at(30, 'ident')], canWrite: true, idents: [ident('seg-1')] });
        const lineup = await lineupOf(20);

        await planner.plant(lineup, rules({ breaks: true, breakEveryMinutes: 0 }), eightPastNine());

        const kinds = lineup.all().flatMap(item => (item.kind === 'segment' ? [item.segmentKind] : []));
        expect(kinds).toEqual(['ident']);
    });

    it('stamps when the break will AIR, not when the operator asked for it', async () => {
        // The order is made of whole records, so the boundary that takes a half-past band is a
        // couple of minutes past it. Words written about the target would describe a moment that
        // had gone by the time anybody heard them.
        // :32, deliberately not a time any boundary falls on. Records are five minutes from 09:00,
        // so the first gap at or after it is 09:35 — three minutes late, and that is what the break
        // has to describe.
        const { planner, plan } = build({ settings: utc(), bands: [at(32, 'talkbreak')], canWrite: true });
        const lineup = await lineupOf(20);

        await planner.plant(lineup, rules({ breaks: true, breakEveryMinutes: 0 }), eightPastNine());

        expect(plan.mock.calls[0]![0].airsAt).toBe(Date.UTC(2026, 7, 13, 9, 35));
    });

    it('plants nothing from a clock when the operator has turned breaks off', async () => {
        const { planner } = build({ settings: utc(), bands: [at(30, 'news')] });
        const lineup = await lineupOf(20);

        expect(await planner.plant(lineup, rules({ breaks: false }), eightPastNine())).toBe(0);
    });
});

describe('BreakPlanner.ripen', () => {
    /** Every segment id a write was asked for. */
    const asked = (send: { mock: { calls: unknown[][] } }): string[] =>
        send.mock.calls.filter(([name]) => name === 'director.write_break').map(([, payload]) => (payload as { segmentId: string }).segmentId);

    it('asks for the words of a break inside the window', async () => {
        const { planner, send } = build({ canWrite: true });
        const lineup = await lineupOf(12);
        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());

        await planner.ripen(lineup);

        expect(asked(send)).toContain('planned-1');
    });

    it('leaves a break further out than the window alone', async () => {
        // The one this phase exists for. A long order gets its breaks laid out to the end of it and
        // pays for the words of the near ones only.
        const { planner, send } = build({ canWrite: true, idents: [] });
        const lineup = await lineupOf(40);
        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());

        await planner.ripen(lineup);

        const planted = lineup.all().flatMap(item => (item.kind === 'segment' ? [item.segmentId] : []));
        expect(planted.length).toBeGreaterThan(asked(send).length);
        expect(asked(send).length).toBeLessThanOrEqual(Math.ceil(WRITE_AHEAD / 2));
    });

    it('asks again on the next pass for a break still unwritten', async () => {
        // Sending is free, because the job claims the row before it does anything. That is what lets
        // this re-offer rather than keep a list of what it has already asked for — a list which,
        // being in memory, would be wrong after every restart in the direction that loses breaks.
        const { planner, send } = build({ canWrite: true });
        const lineup = await lineupOf(12);
        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());

        await planner.ripen(lineup);
        await planner.ripen(lineup);

        expect(asked(send).filter(id => id === 'planned-1')).toHaveLength(2);
    });

    it('does not ask again for a break somebody is already writing', async () => {
        const { planner, send, known } = build({ canWrite: true });
        const lineup = await lineupOf(12);
        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());
        await planner.ripen(lineup);
        known.set('planned-1', { ...known.get('planned-1')!, state: 'writing' });

        await planner.ripen(lineup);

        expect(asked(send).filter(id => id === 'planned-1')).toHaveLength(1);
    });

    it.each(['writing', 'written', 'rendering', 'ready', 'failed'] as const)('asks for nothing when the break is already %s', async state => {
        const { planner, send, known } = build({ canWrite: true });
        const lineup = await lineupOf(12);
        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());
        for (const [id, segment] of known) if (id.startsWith('planned-')) known.set(id, { ...segment, state });

        expect((await planner.ripen(lineup)).offered).toBe(0);
        expect(asked(send)).toEqual([]);
    });

    it('costs no query on an order whose window holds no segments', async () => {
        // Which is most boundaries. The window is a slice of an array in memory, and the database is
        // only reached when that slice actually holds a break.
        const { planner, send } = build({ canWrite: true });
        const lineup = await lineupOf(12);

        expect((await planner.ripen(lineup)).offered).toBe(0);
        expect(send).not.toHaveBeenCalled();
    });

    it('measures the window from the cursor, so it moves with the broadcast', async () => {
        const { planner, send } = build({ canWrite: true, idents: [] });
        const lineup = await lineupOf(40);
        await planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());
        await planner.ripen(lineup);
        const before = new Set(asked(send));

        hand(lineup, 20);
        await planner.ripen(lineup);

        // Breaks that were out of reach the first time are asked for once the station has played its
        // way toward them, which is the whole behaviour: the window travels with the cursor.
        expect(asked(send).some(id => !before.has(id))).toBe(true);
    });

    it('scales with the break interval rather than against it', async () => {
        // A station told to talk after every record is asking for a window with more breaks in it,
        // and should get them. Deliberately not capped: a claim makes a duplicate send free, renders
        // queue like any other job, and a model is serialised however many are asked for. Which is
        // also what makes a low interval the cheapest way to exercise this whole path by hand.
        const often = build({ canWrite: true, idents: [] });
        const rarely = build({ canWrite: true, idents: [] });
        const busy = await lineupOf(40);
        const quiet = await lineupOf(40);
        await often.planner.plant(busy, rules({ breakEveryMinutes: 1 * TRACK_MINUTES }), clock());
        await rarely.planner.plant(quiet, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());

        await often.planner.ripen(busy);
        await rarely.planner.ripen(quiet);

        expect(asked(often.send).length).toBeGreaterThan(asked(rarely.send).length);
        expect(asked(often.send).length).toBeLessThanOrEqual(WRITE_AHEAD);
    });

    // A break already written can still go wrong before its slot, and this window is the last place
    // that is worth doing anything about: the hand-over check drops it, and a dropped break is a
    // boundary of silence. Everything here is about un-writing one early enough to say something
    // true instead.
    describe('the words that stopped being true', () => {
        /** Plant one break, write it, and have it promise whatever plays next. */
        const written = async (): Promise<{ built: ReturnType<typeof build>; lineup: StationLineup; segmentId: string; promised: string }> => {
            const built = build({ canWrite: true });
            const lineup = await lineupOf(12);
            await built.planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());

            const at = lineup.all().findIndex(item => item.kind === 'segment');
            const segmentId = (lineup.all()[at] as { segmentId: string }).segmentId;
            const promised = lineup.nextTrackAfter(lineup.all()[at]!.id)!.id;
            built.known.set(segmentId, { ...built.known.get(segmentId)!, state: 'written', script: 'Coming up.', claimsItemId: promised });

            return { built, lineup, segmentId, promised };
        };

        it('leaves a break alone while its promise still holds', async () => {
            const { built, lineup } = await written();

            const result = await built.planner.ripen(lineup);

            expect(result.rewritten).toEqual([]);
            // And it is not re-offered either: a written break needs no words.
            expect(asked(built.send)).toEqual([]);
        });

        it('un-writes a break the running order has moved under, and asks for its words in the same pass', async () => {
            const { built, lineup, segmentId, promised } = await written();
            // The operator's edit. The record the break named is no longer what plays after it.
            lineup.move(promised, lineup.all().length - 1);

            const result = await built.planner.ripen(lineup);

            expect(result.rewritten).toEqual([segmentId]);
            expect(asked(built.send)).toEqual([segmentId]);
            // Back to exactly the state a freshly planted break is in, so the job writes it against
            // the order as it now stands rather than editing what it said before.
            expect(built.known.get(segmentId)).toMatchObject({ state: 'planned' });
            expect(built.known.get(segmentId)!.script).toBeUndefined();
            expect(built.known.get(segmentId)!.claimsItemId).toBeUndefined();
        });

        it('un-writes a break whose words are no longer true of the time', async () => {
            const { built, lineup, segmentId } = await written();
            const segment = built.known.get(segmentId)!;
            const { claimsItemId, ...rest } = segment;
            // A break that said "it's just after nine" at ten past. Nothing moved; the clock did.
            built.known.set(segmentId, { ...rest, claimsTime: { from: Date.now() - 7_200_000, until: Date.now() - 3_600_000 } });

            expect((await built.planner.ripen(lineup)).rewritten).toEqual([segmentId]);
        });

        it('leaves alone a break written for a window that has not come round yet', async () => {
            // The failure this is the guard for: `WRITE_AHEAD` is eight items and a phrasing is
            // seven minutes wide, so a break planted on a clock band is stamped for a window half an
            // hour out and looks "broken" on every single pass until its slot arrives. A rewrite
            // cannot fix it — the words come from the same `airsAt` — so it would loop, and for a
            // bulletin each turn of that loop spends three headlines out of the read log.
            const { built, lineup, segmentId } = await written();
            const segment = built.known.get(segmentId)!;
            const { claimsItemId, ...rest } = segment;
            built.known.set(segmentId, { ...rest, claimsTime: { from: Date.now() + 1_800_000, until: Date.now() + 2_220_000 } });

            expect((await built.planner.ripen(lineup)).rewritten).toEqual([]);
            // And it keeps its words: nothing about it is wrong yet.
            expect(built.known.get(segmentId)).toMatchObject({ state: 'written' });
        });

        it('will not touch a break somebody is in the middle of rendering', async () => {
            // The state guard lives in the repository, because a row moved underneath a job finishes
            // into a state its caller no longer owns.
            const { built, lineup, segmentId, promised } = await written();
            built.known.set(segmentId, { ...built.known.get(segmentId)!, state: 'rendering' });
            lineup.move(promised, lineup.all().length - 1);

            expect((await built.planner.ripen(lineup)).rewritten).toEqual([]);
            expect(built.known.get(segmentId)).toMatchObject({ state: 'rendering' });
        });

        it('keeps a segment that is still correct at one of its positions', async () => {
            // Idents come from a shared library, so the same row is legitimately at three slots in an
            // hour. Judging it at the first position would un-write a break that is perfectly correct
            // at the others.
            const { built, lineup, segmentId, promised } = await written();
            const at = lineup.all().findIndex(item => item.kind === 'segment');
            // A second appearance of the same row, further down the window, promising nothing that
            // has moved: `nextTrackAfter` there still answers with the line it claims.
            lineup.insertSegment(segmentId, at + 2);
            const second = lineup.all()[at + 2]!;
            built.known.set(segmentId, { ...built.known.get(segmentId)!, claimsItemId: lineup.nextTrackAfter(second.id)!.id });
            lineup.move(promised, lineup.all().length - 1);

            expect((await built.planner.ripen(lineup)).rewritten).toEqual([]);
        });

        it('carries on with the pass when the repair itself fails', async () => {
            const { built, lineup, promised } = await written();
            built.reopenSegments.mockRejectedValueOnce(new Error('the database said no'));
            lineup.move(promised, lineup.all().length - 1);

            // Answers rather than throwing, so a repair that could not run costs one break its
            // rewrite and does not take the words of everything else in the window with it.
            await expect(built.planner.ripen(lineup)).resolves.toMatchObject({ rewritten: [] });
        });
    });

    // A job that died holding a break used to strand it for good: its retry re-claims nothing,
    // because the claim it needs has already been taken, and nothing else ever looks at the row.
    // This station's database has rows stuck that way since August.
    describe('a break whose job never came back', () => {
        /** One planted break, claimed by a job that then died `ago` milliseconds back. */
        const stranded = async (state: 'writing' | 'rendering', ago: number, script?: string) => {
            const built = build({ canWrite: true });
            const lineup = await lineupOf(12);
            await built.planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());

            const segmentId = (lineup.all().find(item => item.kind === 'segment') as { segmentId: string }).segmentId;
            built.known.set(segmentId, { ...built.known.get(segmentId)!, state, ...(script === undefined ? {} : { script }) });
            built.touched.set(segmentId, Date.now() - ago);

            return { built, lineup, segmentId };
        };

        it('takes back a break nobody finished writing, and asks for its words again', async () => {
            const { built, lineup, segmentId } = await stranded('writing', 600_000);

            const result = await built.planner.ripen(lineup);

            expect(result.released).toEqual([segmentId]);
            expect(built.known.get(segmentId)).toMatchObject({ state: 'planned' });
            // In the same pass. A row handed back and then not offered until the next boundary is a
            // boundary of the write window spent doing nothing.
            expect(asked(built.send)).toEqual([segmentId]);
        });

        it('leaves a job that is merely slow alone', async () => {
            // The margin over the job's own expiry is the whole point: two writers for one break is
            // worse than a break that took a minute longer.
            const { built, lineup, segmentId } = await stranded('writing', 30_000);

            expect((await built.planner.ripen(lineup)).released).toEqual([]);
            expect(built.known.get(segmentId)).toMatchObject({ state: 'writing' });
        });

        it('takes back a stranded render at its WORDS rather than at the start', async () => {
            // What `written` being its own state is for: a retry re-speaks the words already
            // decided instead of paying a writer to invent different ones.
            const { built, lineup, segmentId } = await stranded('rendering', 1_800_000, 'That was the last one.');

            expect((await built.planner.ripen(lineup)).released).toEqual([segmentId]);
            expect(built.known.get(segmentId)).toMatchObject({ state: 'written', script: 'That was the last one.' });
            // And it is not offered for writing: it has its words.
            expect(asked(built.send)).toEqual([]);
        });

        it('carries on with the pass when the sweep itself fails', async () => {
            const { built, lineup } = await stranded('writing', 600_000);
            built.releaseStranded.mockRejectedValueOnce(new Error('the database said no'));

            await expect(built.planner.ripen(lineup)).resolves.toMatchObject({ released: [] });
        });
    });

    // Every failed segment in this station's history is the same thing: a speech server that was not
    // running, with a perfectly good script sitting beside the error. The words are not the problem
    // and nothing ever asked for the audio again.
    describe('a break that never got its audio', () => {
        /** One planted break, written and then failed at the render. */
        const failedRender = async (options: { failures?: number; speaker?: boolean } = {}) => {
            const built = build({ canWrite: true, speaker: options.speaker ?? true });
            const lineup = await lineupOf(12);
            await built.planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());

            const at = lineup.all().findIndex(item => item.kind === 'segment');
            const segmentId = (lineup.all()[at] as { segmentId: string }).segmentId;
            built.known.set(segmentId, { ...built.known.get(segmentId)!, state: 'failed', script: 'That was the last one.' });
            built.failures.set(segmentId, options.failures ?? 1);

            return { built, lineup, segmentId, at };
        };

        /** Every segment id a render was asked for. */
        const rendered = (send: { mock: { calls: unknown[][] } }): string[] =>
            send.mock.calls.filter(([name]) => name === 'render.segment').map(([, payload]) => (payload as { segmentId: string }).segmentId);

        it('asks again for the audio of a break whose words survived', async () => {
            const { built, lineup, segmentId } = await failedRender();

            expect((await built.planner.ripen(lineup)).rerendered).toEqual([segmentId]);
            expect(rendered(built.send)).toEqual([segmentId]);
            // And it is NOT offered for writing: the words are not what failed.
            expect(asked(built.send)).toEqual([]);
        });

        it('gives up after three failures', async () => {
            // A break that has failed three times is more likely to be one nothing can speak than a
            // run of bad luck, and asking forever fills a job queue for as long as an engine is down.
            const { built, lineup } = await failedRender({ failures: 3 });

            expect((await built.planner.ripen(lineup)).rerendered).toEqual([]);
            expect(rendered(built.send)).toEqual([]);
        });

        it('asks for nothing at all when no plugin can speak', async () => {
            // Four of this station's six failures are exactly this, so the check is worth making
            // before the query rather than after it.
            const { built, lineup } = await failedRender({ speaker: false });

            expect((await built.planner.ripen(lineup)).rerendered).toEqual([]);
            expect(built.failedWithScript).not.toHaveBeenCalled();
        });

        it('leaves a break that failed with nothing to say', async () => {
            // The other failure entirely: no writer had anything true to say about these two
            // records, and asking again does not change that.
            const { built, lineup, segmentId } = await failedRender();
            const { script, ...wordless } = built.known.get(segmentId)!;
            expect(script).toBeDefined();
            built.known.set(segmentId, wordless);

            expect((await built.planner.ripen(lineup)).rerendered).toEqual([]);
        });

        it('will not pay for the audio of a break whose promise has broken', async () => {
            // Those words are wrong as well as unspoken, so the audio would buy a break the
            // hand-over check drops anyway.
            const { built, lineup, segmentId, at } = await failedRender();
            const promised = lineup.nextTrackAfter(lineup.all()[at]!.id)!.id;
            built.known.set(segmentId, { ...built.known.get(segmentId)!, claimsItemId: promised });
            lineup.move(promised, lineup.all().length - 1);

            expect((await built.planner.ripen(lineup)).rerendered).toEqual([]);
        });

        it('speaks a stranded render that the sweep handed back', async () => {
            // The other half of the sweep: a released render is `written` with its words intact, and
            // nothing else would ever ask for its audio.
            const built = build({ canWrite: true });
            const lineup = await lineupOf(12);
            await built.planner.plant(lineup, rules({ breakEveryMinutes: 4 * TRACK_MINUTES }), clock());
            const segmentId = (lineup.all().find(item => item.kind === 'segment') as { segmentId: string }).segmentId;
            built.known.set(segmentId, { ...built.known.get(segmentId)!, state: 'rendering', script: 'Coming up.' });
            built.touched.set(segmentId, Date.now() - 1_800_000);

            const result = await built.planner.ripen(lineup);

            expect(result.released).toEqual([segmentId]);
            expect(result.rerendered).toEqual([segmentId]);
        });
    });

    // The same question for a break with no position at all. An `interrupt` or `next` request is
    // rendered BEFORE it is injected, so `ripen` — which walks the running order — can never reach
    // its segment, and a render that lost the race with plugin startup ended the request outright.
    describe('retryRenderOf', () => {
        const rendered = (send: { mock: { calls: unknown[][] } }): string[] =>
            send.mock.calls.filter(([name]) => name === 'render.segment').map(([, payload]) => (payload as { segmentId: string }).segmentId);

        const waiting = (state: string, extra: Record<string, unknown> = {}) =>
            ({ id: 'seg-waiting', kind: 'welcome', state, script: 'Welcome in.', source: 'render', ...extra }) as unknown as Segment;

        it('asks for the audio of a break whose words are decided and unspoken', async () => {
            // `written` is what a render handed back when the HOST was not ready leaves behind, and
            // it has never been tried, so it is free to ask for.
            const built = build({ canWrite: true });

            expect(await built.planner.retryRenderOf(waiting('written'))).toBe(true);
            expect(rendered(built.send)).toEqual(['seg-waiting']);
            // Never counted against the bound: nothing has failed.
            expect(built.failedWithScript).not.toHaveBeenCalled();
        });

        it('asks again for one that failed, on the same bound the running order uses', async () => {
            const built = build({ canWrite: true });
            built.known.set('seg-waiting', waiting('failed'));
            built.failures.set('seg-waiting', 2);

            expect(await built.planner.retryRenderOf(waiting('failed'))).toBe(true);
            expect(rendered(built.send)).toEqual(['seg-waiting']);
        });

        it('gives up after three failures, exactly as the running order does', async () => {
            const built = build({ canWrite: true });
            built.known.set('seg-waiting', waiting('failed'));
            built.failures.set('seg-waiting', 3);

            expect(await built.planner.retryRenderOf(waiting('failed'))).toBe(false);
            expect(rendered(built.send)).toEqual([]);
        });

        it('leaves a break that failed with nothing to say', async () => {
            // `failedWithScript` answers nothing for a wordless row, which is the other failure
            // entirely: asking again does not give anybody something true to say.
            const built = build({ canWrite: true });

            expect(await built.planner.retryRenderOf(waiting('failed'))).toBe(false);
            expect(rendered(built.send)).toEqual([]);
        });

        it('asks for nothing when no plugin can speak', async () => {
            const built = build({ canWrite: true, speaker: false });

            expect(await built.planner.retryRenderOf(waiting('written'))).toBe(false);
            expect(rendered(built.send)).toEqual([]);
        });

        it('declines a state that is not its business', async () => {
            // `planned` is the write job's, and `rendering`/`ready` are already somebody's. Only the
            // two states where the words exist and the audio does not are answerable here.
            const built = build({ canWrite: true });

            for (const state of ['planned', 'writing', 'rendering', 'ready']) {
                expect(await built.planner.retryRenderOf(waiting(state))).toBe(false);
            }
            expect(rendered(built.send)).toEqual([]);
        });
    });

    // Where a break somebody ASKED for goes. A different question from the spacing above: that one
    // is about elapsed airtime and is recomputed every pass, this one is about the clock — how long
    // a write and a render need — and is asked once.
    describe('plantRequested', () => {
        const asking = (overrides: Partial<StoredBreakRequest> = {}): StoredBreakRequest => ({
            id: 'req-1',
            kind: TALK_BREAK_KIND,
            urgency: 'next',
            source: 'audience',
            state: 'placed',
            ...overrides,
        });

        it('places a request at the first boundary far enough ahead to write and speak into', async () => {
            const { planner } = build({ canWrite: true });
            // The first record is airing and started a moment ago, so the boundary in front of it is
            // whole records away and the one behind it has already gone.
            const lineup = await lineupOf(6, 1);
            const now = Date.UTC(2026, 7, 13, 9, 0);

            const result = await planner.plantRequested(lineup, rules(), { now, anchorAt: now, from: 0 }, asking());

            expect(result.accepted).toBe(true);
            // Not the head: index 1 is the boundary at the end of the record now playing, five
            // minutes off, which is comfortably past the lead a write and a render need.
            expect(result.atIndex).toBe(1);
            expect(segmentsAt(lineup)).toEqual([1]);
        });

        it('passes over a boundary that is too close for the words to exist by then', async () => {
            const { planner } = build({ canWrite: true });
            const lineup = await lineupOf(6, 1);
            // The record on air started four minutes and fifty seconds ago, so the boundary in front
            // of it is ten seconds away: real, reachable, and no use to a renderer.
            const now = Date.UTC(2026, 7, 13, 9, 0);
            const anchorAt = now - (TRACK_MINUTES * 60_000 - 10_000);

            const result = await planner.plantRequested(lineup, rules(), { now, anchorAt, from: 0 }, asking());

            expect(result.atIndex).toBe(2);
        });

        it('rides the record rather than the gap when it is asked to interrupt', async () => {
            const { planner } = build({ canWrite: true });
            const lineup = await lineupOf(6, 1);
            const now = Date.UTC(2026, 7, 13, 9, 0);

            const result = await planner.plantRequested(lineup, rules(), { now, anchorAt: now, from: 0 }, asking({ urgency: 'interrupt' }));

            expect(result.accepted).toBe(true);
            const placed = lineup.all()[result.atIndex!]!;
            expect(placed.kind === 'segment' && placed.over).toEqual({ atMs: INTERRUPT_OVER_AT_MS });
        });

        it('declines a soon request the order cannot fit inside its deadline', async () => {
            const { planner } = build({ canWrite: true });
            // Two records of programme, both spent: everything left is past the deadline because
            // there is nothing left at all.
            const lineup = await lineupOf(2, 2);
            const now = Date.UTC(2026, 7, 13, 9, 0);

            const result = await planner.plantRequested(lineup, rules(), { now, anchorAt: now, from: 0 }, asking({ urgency: 'soon' }));

            expect(result.accepted).toBe(false);
            expect(result.reason).toContain('no boundary far enough ahead');
        });

        it('never puts a request next to a break that is already there', async () => {
            const { planner } = build({ canWrite: true });
            const lineup = await lineupOf(6, 1);
            // Exactly where the request would otherwise have gone.
            lineup.insertSegments([{ segmentId: 'already-here', atIndex: 1 }]);
            const now = Date.UTC(2026, 7, 13, 9, 0);

            const result = await planner.plantRequested(lineup, rules(), { now, anchorAt: now, from: 0 }, asking());

            expect(result.accepted).toBe(true);
            expect(result.atIndex).not.toBe(1);
        });

        it('declines when nothing can write the kind, or nothing can speak it', async () => {
            const mute = build({ canWrite: true, speaker: false });
            const lineup = await lineupOf(6, 1);
            const now = Date.UTC(2026, 7, 13, 9, 0);

            expect((await mute.planner.plantRequested(lineup, rules(), { now, anchorAt: now, from: 0 }, asking())).reason).toContain('no voice');

            const speechless = build({ canWrite: false, speaker: true });
            const unwritable = await speechless.planner.plantRequested(lineup, rules(), { now, anchorAt: now, from: 0 }, asking({ kind: 'news' }));
            expect(unwritable.reason).toContain('knows how to write a news');

            // And the operator's own switch, which turns every break off including the asked-for kind.
            const quiet = build({ canWrite: true });
            const silenced = await quiet.planner.plantRequested(lineup, rules({ breaks: false }), { now, anchorAt: now, from: 0 }, asking());
            expect(silenced.accepted).toBe(false);
        });

        it('declines a welcome on a station that has been told not to greet anybody', async () => {
            // Judged here rather than in whatever asked, so the rule is true for a console button and
            // a scheduler as well as for the audience watch — and resolved against the running order,
            // so a broadcast may turn greetings off without touching the station's own setting.
            const { planner } = build({ canWrite: true });
            const lineup = await lineupOf(6, 1);
            const now = Date.UTC(2026, 7, 13, 9, 0);
            const asking = { id: 'req-1', kind: WELCOME_KIND, urgency: 'next', source: 'audience', state: 'placed' } as StoredBreakRequest;

            const off = await planner.plantRequested(lineup, rules({ welcome: false }), { now, anchorAt: now, from: 0 }, asking);
            expect(off.accepted).toBe(false);
            expect(off.reason).toContain('not to greet');

            // And a talk break on the same station is unaffected: the rule is about greetings.
            const talk = await planner.plantRequested(
                lineup,
                rules({ welcome: false }),
                { now, anchorAt: now, from: 0 },
                { ...asking, kind: TALK_BREAK_KIND },
            );
            expect(talk.accepted).toBe(true);
        });

        it('stamps the projected air time and the request it came from onto the row', async () => {
            // Both travel on the row because the words are asked for on a later pass: the writer is
            // the only thing that will still know when this is going to be spoken and what it is
            // about.
            const { planner, plan } = build({ canWrite: true });
            const lineup = await lineupOf(6, 1);
            const now = Date.UTC(2026, 7, 13, 9, 0);

            await planner.plantRequested(lineup, rules(), { now, anchorAt: now, from: 0 }, asking());

            expect(plan).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-1', airsAt: now + TRACK_MINUTES * 60_000 }));
        });
    });
});
