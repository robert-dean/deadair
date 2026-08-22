// What the console is told the station can make, which has to be the same answer
// `BreakPlanner.fillBand` gives: a kind something can write AND a voice to speak it, or a recording
// on the shelf, plus the kinds made as episodes rather than at a boundary. The rest of this service
// is a repository read and a form's two shapes, which `scripts/clock.smoke.ts` covers against the
// real table.

import { describe, expect, it } from 'vitest';

import { producibleKinds, type StationCapability } from '../../../src/modules/director/clock.service.js';

const station = (over: Partial<StationCapability> = {}): StationCapability => ({
    writable: [],
    hasVoice: true,
    recorded: [],
    produced: [],
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
