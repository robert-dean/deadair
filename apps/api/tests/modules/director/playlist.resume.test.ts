// Where a slot that resumes its playlist picks it up. The opening and the console's preview both read
// it, so these are the cases both have to agree on: after the record that aired last, from the top
// when there is nothing to go on, and round again after the end.

import { describe, expect, it } from 'vitest';

import { playlistKeyOf, resumeAfter, resumeIndex, shuffledOrder } from '../../../src/modules/director/playlist.resume.js';
import { songKey } from '../../../src/modules/director/rotation.keys.js';

const record = (title: string, artist = 'Portishead') => ({ title, artist });
const playlist = [record('Mysterons'), record('Sour Times'), record('Strangers'), record('Roads'), record('Glory Box')];

describe('playlistKeyOf', () => {
    it('is the song key play history writes for the same record, title and lead artist', () => {
        expect(playlistKeyOf(record('Roads'))).toBe(songKey('Roads', ['Portishead']));
    });
});

describe('resumeAfter', () => {
    it('starts with the record after the one that aired last, and carries the rest round to the end', () => {
        const resumed = resumeAfter(playlist, playlistKeyOf(record('Strangers')));

        expect(resumed.map(track => track.title)).toEqual(['Roads', 'Glory Box', 'Mysterons', 'Sour Times', 'Strangers']);
    });

    it('starts from the top when nothing has aired yet', () => {
        expect(resumeAfter(playlist, undefined)).toEqual(playlist);
    });

    it('starts from the top when the record that aired last is no longer on the playlist', () => {
        expect(resumeAfter(playlist, playlistKeyOf(record('Wandering Star')))).toEqual(playlist);
    });

    it('starts from the top again after the last record on the playlist', () => {
        expect(resumeAfter(playlist, playlistKeyOf(record('Glory Box')))).toEqual(playlist);
    });

    it('matches the record however its title is written, as the song key does', () => {
        expect(resumeIndex(playlist, playlistKeyOf(record('ROADS')))).toBe(4);
    });

    it('leaves an empty playlist empty', () => {
        expect(resumeAfter([], playlistKeyOf(record('Roads')))).toEqual([]);
    });
});

describe('a slot that shuffles its playlist', () => {
    it('airs every record exactly once, in a different order', () => {
        const shuffled = shuffledOrder(playlist, () => 0.5);

        expect([...shuffled].sort((a, b) => a.title.localeCompare(b.title))).toEqual([...playlist].sort((a, b) => a.title.localeCompare(b.title)));
        expect(shuffled).not.toEqual(playlist);
    });

    it('draws the same order from the same numbers, so the draw can be tested', () => {
        const rolls = [0, 0.99, 0.3, 0.7];
        const pick = () => rolls.shift() ?? 0;

        const first = shuffledOrder(playlist, pick);
        expect(first.map(record => record.title)).toEqual(['Strangers', 'Sour Times', 'Glory Box', 'Roads', 'Mysterons']);
    });

    it('leaves the playlist it was given as it was', () => {
        const before = playlist.map(record => record.title);
        shuffledOrder(playlist, () => 0.2);

        expect(playlist.map(record => record.title)).toEqual(before);
    });

    it('is an empty list when the playlist is', () => {
        expect(shuffledOrder([], () => 0.5)).toEqual([]);
    });
});
