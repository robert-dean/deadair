// Where a slot that resumes its playlist picks it up. The opening and the console's preview both read
// it, so these are the cases both have to agree on: after the record that aired last, from the top
// when there is nothing to go on, and round again after the end.

import { describe, expect, it } from 'vitest';

import { playlistKeyOf, resumeAfter, resumeIndex } from '../../../src/modules/director/playlist.resume.js';
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
