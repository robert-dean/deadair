// A show's mix flow, evaluated: one record followed down the wires, held at a block or at a limit it
// would take past its amount, with the show's counts read off the records it has already aired. The
// Church flow is the worked example, because it is why this exists: black metal at about a quarter of
// its plays when its brief asked for "only now and then".

import { describe, expect, it } from 'vitest';

import { buildMixContext, progressOf } from '../../../src/modules/director/mix.flow.context.js';
import {
    budgetLeft,
    countThrough,
    dueRequirements,
    walkRecord,
    type CountedRecord,
    type MixContext,
    type MixRecord,
} from '../../../src/modules/director/mix.flow.js';
import type { MixFlow, MixLink } from '../../../src/modules/schedule/types/mix.types.js';

const wire = (from: string, to: string, out = 0, into = 0): MixLink => ({ from, out, to, in: into });

const church = (): MixFlow => ({
    version: 1,
    nodes: [
        { id: 'picks', kind: 'picks' },
        { id: 'block', kind: 'block', bands: ['Burzum'] },
        { id: 'split', kind: 'split', splitBy: 'genre', branches: [{ values: ['black metal'] }, { values: ['pop'] }] },
        { id: 'clock', kind: 'timeSwitch', fromHour: 22, thenValue: 30, elseValue: 10 },
        { id: 'share', kind: 'limitShare', per: 'hour' },
        { id: 'row', kind: 'noRepeat' },
        { id: 'count', kind: 'limitCount', count: 1, per: 'show' },
        { id: 'pop', kind: 'require', requireGenres: ['pop'], afterPercent: 40, songs: [{ title: 'Thriller', artist: 'Michael Jackson' }] },
        { id: 'merge', kind: 'merge' },
        { id: 'air', kind: 'onAir' },
    ],
    links: [
        wire('picks', 'block'),
        wire('block', 'split'),
        wire('split', 'share', 0),
        wire('clock', 'share', 0, 1),
        wire('split', 'row', 1),
        wire('row', 'count'),
        wire('split', 'merge', 2, 2),
        wire('share', 'merge', 0, 0),
        wire('count', 'merge', 0, 1),
        wire('pop', 'merge', 0, 3),
        wire('merge', 'air'),
    ],
});

const rec = (artist: string, mainGenre?: string, title = 'A record'): MixRecord => ({
    title,
    artist,
    ...(mainGenre === undefined ? {} : { mainGenre }),
});
const ctx = (counted: CountedRecord[] = [], hour = 20, showProgress = 0): MixContext => ({ hour, showProgress, counted });
/** `n` heavy metal records counted in an hour, through the everything-else branch. */
const heavy = (n: number, hour = 20): CountedRecord[] =>
    Array.from({ length: n }, () => ({ ...rec('Dio', 'heavy metal'), hour, path: ['picks', 'block', 'split', 'merge', 'air'] }));
const blackMetal = (hour = 20): CountedRecord => ({
    ...rec('Mayhem', 'black metal'),
    hour,
    path: ['picks', 'block', 'split', 'share', 'merge', 'air'],
});

describe('walkRecord', () => {
    it('follows a record to On air through the branch its main genre matches', () => {
        expect(walkRecord(church(), rec('Iron Maiden', 'heavy metal'), ctx())).toEqual({ path: ['picks', 'block', 'split', 'merge', 'air'] });
        // "Norwegian black metal" refines "black metal", so it goes the black metal way.
        expect(walkRecord(church(), rec('Darkthrone', 'Norwegian black metal'), ctx()).path).toContain('share');
    });

    it('holds a blocked band, ignoring case', () => {
        expect(walkRecord(church(), rec('burzum', 'black metal'), ctx())).toEqual({ path: ['picks', 'block'], heldAt: 'block' });
    });

    it('sends a record with no main genre down everything else', () => {
        expect(walkRecord(church(), rec('Somebody'), ctx()).path).toEqual(['picks', 'block', 'split', 'merge', 'air']);
    });

    it('lets the first of a share through, then holds what would take it past its percent of the hour', () => {
        expect(walkRecord(church(), rec('Mayhem', 'black metal'), ctx(heavy(3))).heldAt).toBeUndefined();
        // One of ten this hour already: a second is two in eleven, past 10%.
        expect(walkRecord(church(), rec('Emperor', 'black metal'), ctx([...heavy(9), blackMetal()])).heldAt).toBe('share');
        // One of twenty: a second is two in twenty-one, under 10%.
        expect(walkRecord(church(), rec('Emperor', 'black metal'), ctx([...heavy(19), blackMetal()])).heldAt).toBeUndefined();
    });

    it("counts a share per hour, so the last hour's black metal does not count against this one", () => {
        expect(walkRecord(church(), rec('Emperor', 'black metal'), ctx([...heavy(9, 19), blackMetal(19)], 20)).heldAt).toBeUndefined();
    });

    it('takes the share from the time switch wired into it', () => {
        // After 22:00 it is 30%: two in eight is 25%.
        expect(walkRecord(church(), rec('Emperor', 'black metal'), ctx([...heavy(6, 23), blackMetal(23)], 23)).heldAt).toBeUndefined();
        expect(walkRecord(church(), rec('Emperor', 'black metal'), ctx([...heavy(6, 21), blackMetal(21)], 21)).heldAt).toBe('share');
    });

    it('holds a second pop record in the show, and a pop record straight after one', () => {
        const popAired: CountedRecord = {
            ...rec('Britney Spears', 'pop'),
            hour: 20,
            path: ['picks', 'block', 'split', 'row', 'count', 'merge', 'air'],
        };
        expect(walkRecord(church(), rec('Michael Jackson', 'pop'), ctx([popAired])).heldAt).toBe('row');
        expect(walkRecord(church(), rec('Michael Jackson', 'pop'), ctx([popAired, ...heavy(2)])).heldAt).toBe('count');
        expect(walkRecord(church(), rec('Michael Jackson', 'pop'), ctx(heavy(2))).heldAt).toBeUndefined();
    });

    it('walks a required record from its own node, so wired into Merge it skips the limits', () => {
        expect(walkRecord(church(), rec('Michael Jackson', 'pop'), ctx(), { entry: 'pop' })).toEqual({ path: ['pop', 'merge', 'air'] });
    });

    it('holds nothing when asked only for the path a record took', () => {
        expect(walkRecord(church(), rec('Burzum', 'black metal'), ctx(), { holding: false }).path).toEqual([
            'picks',
            'block',
            'split',
            'share',
            'merge',
            'air',
        ]);
    });
});

describe('countThrough', () => {
    it('gives each counted record the path it takes through the flow as it is now', () => {
        const counted = countThrough(church(), [
            { ...rec('Mayhem', 'black metal'), hour: 20 },
            { ...rec('Dio', 'heavy metal'), hour: 20 },
        ]);
        expect(counted.map(record => record.path.includes('share'))).toEqual([true, false]);
    });
});

describe('dueRequirements', () => {
    it('is not due before its percent of the show, and is once past it with no pop aired', () => {
        expect(dueRequirements(church(), ctx(heavy(5), 20, 30))).toEqual([]);
        expect(dueRequirements(church(), ctx(heavy(5), 20, 45))).toEqual([
            { nodeId: 'pop', genres: ['pop'], songs: [{ title: 'Thriller', artist: 'Michael Jackson' }] },
        ]);
    });

    it('is satisfied by a pop record the show already aired', () => {
        const popAired: CountedRecord = { ...rec('Britney Spears', 'pop'), hour: 20, path: [] };
        expect(dueRequirements(church(), ctx([popAired], 20, 60))).toEqual([]);
    });

    it('wants each genre in turn when asked for one of each', () => {
        const flow = church();
        flow.nodes = flow.nodes.map(node => (node.id === 'pop' ? { ...node, requireGenres: ['pop', 'gospel'], requireMode: 'each' as const } : node));
        const popAired: CountedRecord = { ...rec('Britney Spears', 'pop'), hour: 20, path: [] };
        expect(dueRequirements(flow, ctx([popAired], 20, 60))[0]?.genres).toEqual(['gospel']);
    });
});

describe('budgetLeft', () => {
    it('says what each limit and block allows now, and what reaches it', () => {
        const lines = budgetLeft(church(), ctx([...heavy(9), blackMetal()]));
        expect(lines).toEqual([
            { nodeId: 'block', kind: 'block', reaching: [], bands: ['Burzum'] },
            { nodeId: 'share', kind: 'limitShare', reaching: ['main genre black metal'], left: 0, per: 'hour' },
            { nodeId: 'count', kind: 'limitCount', reaching: ['main genre pop'], left: 1, per: 'show' },
        ]);
    });
});

describe('buildMixContext', () => {
    it('counts what aired and what is queued, each in its hour, with main genres looked up', () => {
        const hourOf = (ms: number) => new Date(ms).getUTCHours();
        const now = Date.UTC(2026, 10, 15, 21, 30);
        const context = buildMixContext({
            flow: church(),
            aired: [{ trackId: 't1', title: 'Freezing Moon', artist: 'Mayhem', airedAtMs: Date.UTC(2026, 10, 15, 20, 10) }],
            queued: [{ trackId: 't2', title: 'Holy Diver', artist: 'Dio' }],
            genres: new Map([
                ['t1', 'black metal'],
                ['t2', 'heavy metal'],
            ]),
            hourOf,
            nowMs: now,
            show: { startMs: Date.UTC(2026, 10, 15, 20), endMs: Date.UTC(2026, 10, 15, 23) },
        });
        expect(context.hour).toBe(21);
        expect(Math.round(context.showProgress)).toBe(50);
        expect(context.counted.map(record => [record.mainGenre, record.hour, record.path.includes('share')])).toEqual([
            ['black metal', 20, true],
            ['heavy metal', 21, false],
        ]);
    });

    it('reads a show with no window as its start', () => {
        expect(progressOf(undefined, 5)).toBe(0);
    });
});
