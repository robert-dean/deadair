// The fold is what the console reads: one row per persona and kind, an empty persona kept apart from
// any named one, and reasons most common first.

import { describe, expect, it } from 'vitest';

import { foldPerformance } from '../../../src/modules/render/script.performance.js';

describe('foldPerformance', () => {
    it('adds outcomes and ratings into one row per persona and kind', () => {
        const rows = foldPerformance([
            { personaKey: 'wayne', kind: 'talkbreak', outcome: 'written', count: 5 },
            { personaKey: 'wayne', kind: 'talkbreak', outcome: 'written', rating: 1, count: 2 },
            { personaKey: 'wayne', kind: 'talkbreak', outcome: 'written', rating: 0, count: 1 },
            { personaKey: 'wayne', kind: 'talkbreak', outcome: 'written', rating: -1, count: 3 },
            { personaKey: 'wayne', kind: 'talkbreak', outcome: 'failed', reason: 'it threw', count: 1 },
            { personaKey: 'wayne', kind: 'weather', outcome: 'written', count: 4 },
        ]);

        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual({
            personaKey: 'wayne',
            kind: 'talkbreak',
            written: 11,
            declined: 0,
            failed: 1,
            liked: 2,
            neutral: 1,
            disliked: 3,
            declineReasons: [],
        });
        expect(rows[1]).toMatchObject({ kind: 'weather', written: 4 });
    });

    it('counts decline reasons most common first, and only declines', () => {
        const [row] = foldPerformance([
            { personaKey: 'wayne', kind: 'talkbreak', outcome: 'declined', reason: 'rare', count: 1 },
            { personaKey: 'wayne', kind: 'talkbreak', outcome: 'declined', reason: 'common', count: 4 },
            { personaKey: 'wayne', kind: 'talkbreak', outcome: 'declined', count: 2 },
        ]);

        expect(row?.declined).toBe(7);
        expect(row?.declineReasons).toEqual([
            { reason: 'common', count: 4 },
            { reason: 'rare', count: 1 },
        ]);
    });

    it('keeps attempts with no presenter as their own row, with no persona key at all', () => {
        const rows = foldPerformance([
            { kind: 'talkbreak', outcome: 'written', count: 1 },
            { personaKey: 'wayne', kind: 'talkbreak', outcome: 'written', count: 1 },
        ]);

        expect(rows).toHaveLength(2);
        expect(rows[0]).not.toHaveProperty('personaKey');
    });
});
