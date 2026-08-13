// Subsonic search is a substring match with no relevance order worth trusting,
// so a library holding an album track, a live version and a greatest-hits copy
// returns all three and the right one is not reliably first.

import { describe, expect, it } from 'vitest';

import { baseForm, normalize } from '@deadair/plugin-sdk';

import { selectSong } from '../src/navidrome.match.js';

const ref = { artist: 'Portishead', title: 'Roads', album: 'Dummy' };

describe('normalize', () => {
    it('sees through accents, case and punctuation', () => {
        expect(normalize('Beyoncé')).toBe(normalize('BEYONCE'));
        expect(normalize('Mr. Brightside')).toBe(normalize('Mr Brightside'));
    });
});

describe('baseForm', () => {
    it('sees through the decorations a personal library is full of', () => {
        expect(baseForm('Roads (2011 Remaster)')).toBe('roads');
        expect(baseForm('Roads - Live')).toBe('roads');
        expect(baseForm('Roads [Radio Edit]')).toBe('roads');
    });
});

describe('selectSong', () => {
    it('takes the exact match over a decorated one, whatever order they arrive in', () => {
        const songs = [
            { id: 'live', title: 'Roads - Live', artist: 'Portishead' },
            { id: 'album', title: 'Roads', artist: 'Portishead' },
        ];

        expect(selectSong(songs, ref)?.id).toBe('album');
    });

    it('breaks a tie with the album, which picks the album track over the compilation copy', () => {
        const songs = [
            { id: 'hits', title: 'Roads', artist: 'Portishead', album: 'Greatest Hits' },
            { id: 'album', title: 'Roads', artist: 'Portishead', album: 'Dummy' },
        ];

        expect(selectSong(songs, ref)?.id).toBe('album');
    });

    it('still answers when only the decorated version exists', () => {
        expect(selectSong([{ id: 'remaster', title: 'Roads (2011 Remaster)', artist: 'Portishead' }], ref)?.id).toBe('remaster');
    });

    it('refuses a title match by a different artist', () => {
        // The failure mode this whole file exists to prevent: attributing one
        // recording's tags to a different song with the same name.
        expect(selectSong([{ id: 'other', title: 'Roads', artist: 'Someone Else' }], ref)).toBeUndefined();
    });

    it('refuses an artist match with a different title', () => {
        expect(selectSong([{ id: 'other', title: 'Glory Box', artist: 'Portishead' }], ref)).toBeUndefined();
    });

    it('never treats a matching album as evidence on its own', () => {
        // A compilation's title matching proves only that some song is on a record
        // with that name.
        expect(selectSong([{ id: 'x', title: 'Wandering Star', artist: 'Someone Else', album: 'Dummy' }], ref)).toBeUndefined();
    });

    it('has nothing to say about an empty or idless result set', () => {
        expect(selectSong([], ref)).toBeUndefined();
        expect(selectSong(undefined, ref)).toBeUndefined();
        expect(selectSong([{ title: 'Roads', artist: 'Portishead' }], ref)).toBeUndefined();
    });
});
