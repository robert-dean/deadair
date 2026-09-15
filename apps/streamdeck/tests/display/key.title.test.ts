import { describe, expect, it } from 'vitest';

import { fitLine, LINE_CHARACTERS, nowPlayingTitle } from '../../src/display/key.title.js';
import { record } from '../fixtures/playout.status.js';

describe('fitLine', () => {
    it('leaves a line that fits alone', () => {
        expect(fitLine('Heroes')).toBe('Heroes');
    });

    it('cuts a long one with an ellipsis, inside the width', () => {
        const line = fitLine('Pale Blue Eyes And Other Things');
        expect(line).toBe('Pale Blue…');
        expect([...line].length).toBeLessThanOrEqual(LINE_CHARACTERS);
    });

    it('cuts between characters, never through one', () => {
        const line = fitLine('🎸🎸🎸🎸🎸🎸🎸🎸🎸🎸🎸🎸🎸');
        expect(line).toBe(`${'🎸'.repeat(LINE_CHARACTERS - 1)}…`);
    });

    it('folds runs of space, so a title cannot push the rest of the line off the key', () => {
        expect(fitLine('  So   Far  ')).toBe('So Far');
    });
});

describe('nowPlayingTitle', () => {
    it('is the title over who it is by', () => {
        expect(nowPlayingTitle({ ...record, title: 'Heroes', artists: ['David Bowie'] })).toBe('Heroes\nDavid Bowie');
    });

    it('names every artist, and cuts them as one line', () => {
        expect(nowPlayingTitle({ ...record, title: 'Under Pressure', artists: ['Queen', 'David Bowie'] })).toBe('Under Pres…\nQueen, Dav…');
    });

    it('is one line for a break, which has nobody to credit', () => {
        expect(nowPlayingTitle({ ...record, title: 'Station ident', artists: [] })).toBe('Station id…');
    });
});
