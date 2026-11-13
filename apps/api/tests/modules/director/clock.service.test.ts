// What the console is told the station can make, which has to be the same answer
// `BreakPlanner.fillBand` gives: a kind something can write AND a voice to speak it, or a recording
// on the shelf, plus the kinds made as episodes rather than at a boundary. The rest of this service
// is a repository read and a form's two shapes, which `scripts/clock.smoke.ts` covers against the
// real table.

import { describe, expect, it } from 'vitest';

import type { ClockBandRecord } from '../../../src/modules/director/clock.bands.js';
import { keepingHard, producibleKinds, type StationCapability } from '../../../src/modules/director/clock.service.js';

const station = (over: Partial<StationCapability> = {}): StationCapability => ({
    writable: [],
    hasVoice: true,
    recorded: [],
    produced: [],
    carried: [],
    ...over,
});

describe('producibleKinds', () => {
    it('takes what the station can write when it has a voice', () => {
        expect(producibleKinds(station({ writable: ['news', 'talkbreak'] }))).toEqual(['news', 'talkbreak']);
    });

    it('withholds every written kind when nothing can speak', () => {
        // A script nothing can render is a break planted, written and then skipped at every slot it
        // is given, which is exactly what the planner refuses to plant.
        expect(producibleKinds(station({ writable: ['news', 'talkbreak'], hasVoice: false }))).toEqual([]);
    });

    it('keeps a recorded kind when there is no voice, because those are already audio', () => {
        expect(producibleKinds(station({ writable: ['news'], hasVoice: false, recorded: ['ident'] }))).toEqual(['ident']);
    });

    it('counts a kind made as an episode, which no break writer claims', () => {
        expect(producibleKinds(station({ writable: ['news'], produced: ['podcast'] }))).toEqual(['news', 'podcast']);
    });

    it('counts a programme carried from somebody else, which no break writer claims either', () => {
        expect(producibleKinds(station({ writable: ['news'], carried: ['syndicated'] }))).toEqual(['news', 'syndicated']);
    });

    it('answers each kind once, however many ways the station can make it', () => {
        expect(producibleKinds(station({ writable: ['ident'], recorded: ['ident'] }))).toEqual(['ident']);
    });

    it('sorts, so a suggestion list does not reshuffle between reads', () => {
        expect(producibleKinds(station({ writable: ['talkbreak', 'news'], recorded: ['ident'] }))).toEqual(['ident', 'news', 'talkbreak']);
    });

    it('answers nothing for a station that can neither write nor play anything', () => {
        expect(producibleKinds(station())).toEqual([]);
    });
});

// `PUT` replaces the row, and a console that predates hard markers never sends the field. A reorder from one
// must not make the news soft, and a console that knows the field must still be able to.
describe('keepingHard', () => {
    const stored = (hard: boolean): ClockBandRecord => ({
        id: 'b',
        at: 'clock',
        minute: 0,
        kind: 'news',
        position: 0,
        enabled: true,
        ...(hard ? { hard } : {}),
    });
    const save = { kind: 'news', at: 'clock' as const, minute: 0, position: 1, enabled: true };

    it('keeps a stored hard marker hard when the save does not mention it', () => {
        expect(keepingHard(save, stored(true)).hard).toBe(true);
    });

    it('lets an explicit false make it soft', () => {
        expect(keepingHard({ ...save, hard: false }, stored(true)).hard).toBe(false);
    });

    it('leaves a soft band soft', () => {
        expect(keepingHard(save, stored(false)).hard).toBeUndefined();
    });

    it('never makes an interval band hard, which has no time to hit', () => {
        expect(keepingHard({ kind: 'ident', at: 'interval', everyMs: 600_000, position: 0, enabled: true }, stored(true)).hard).toBeUndefined();
    });

    it('answers the save unchanged for a band nobody holds any more', () => {
        expect(keepingHard(save, undefined)).toEqual(save);
    });
});
