import { describe, expect, it } from 'vitest';

import { describeFill } from '../../../src/modules/playlists/playlist.fill.job.js';

describe('describeFill', () => {
    it('names the playlist and says how many of its missing records were found', () => {
        expect(describeFill('Late night', { filled: 3, missed: 1, remaining: 0 })).toBe(
            '3 of the 4 records missing from "Late night" were found and added to the library.',
        );
    });

    it('says what is left for the next look-up', () => {
        expect(describeFill('Late night', { filled: 1, missed: 1, remaining: 5 })).toBe(
            '1 of the 2 records missing from "Late night" was found and added to the library. 5 more are left for the next look-up.',
        );
    });

    it('speaks of one record as one record, found or not', () => {
        expect(describeFill('Late night', { filled: 1, missed: 0, remaining: 0 })).toBe(
            'The record missing from "Late night" was found and added to the library.',
        );
        expect(describeFill('Late night', { filled: 0, missed: 1, remaining: 0 })).toBe(
            'The record missing from "Late night" was not found at any music source.',
        );
    });

    it('names the switch when the station may not add records at all', () => {
        expect(describeFill('Late night', { filled: 0, missed: 0, remaining: 2, refused: 'discover-off' })).toContain('"rotation.discover" is off');
    });
});
