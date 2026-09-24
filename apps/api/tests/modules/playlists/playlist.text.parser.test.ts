// Three shapes a playlist arrives in from outside deadair, each tested against the text the software
// that writes it actually produces. A line that names no record is counted, never guessed at.

import { describe, expect, it } from 'vitest';

import { detectFormat, parsePlaylistText, splitArtistTitle, splitCsvLine } from '../../../src/modules/playlists/playlist.text.parser.js';

// The columns Exportify writes, in its order, with one row carrying a comma inside a quoted title.
const EXPORTIFY = [
    '"Track URI","Track Name","Artist URI(s)","Artist Name(s)","Album URI","Album Name","Album Artist URI(s)","Album Artist Name(s)","Album Release Date","Album Image URL","Disc Number","Track Number","Track Duration (ms)","Track Preview URL","Explicit","Popularity","ISRC","Added By","Added At"',
    '"spotify:track:1","Teardrop","spotify:artist:1","Massive Attack","spotify:album:1","Mezzanine","spotify:artist:1","Massive Attack","1998-04-20","https://i.scdn.co/1","1","3","330773","","false","71","gbaaa9800123","spotify:user:x","2024-01-01T00:00:00Z"',
    '"spotify:track:2","Hey, Ya!","spotify:artist:2","Outkast, André 3000","spotify:album:2","Speakerboxxx","spotify:artist:2","Outkast","2003-09-23","","1","9","235213","","false","80","USAR10300924","spotify:user:x","2024-01-01T00:00:00Z"',
    '"spotify:track:3","","spotify:artist:3","Nobody","","","","","","","1","1","1000","","false","0","","",""',
].join('\n');

// What VLC and most players write: a header, #EXTINF with seconds and a display string, then a path.
const VLC = [
    '#EXTM3U',
    '#PLAYLIST:Late night',
    '#EXTINF:330,Massive Attack - Teardrop',
    '/Users/somebody/Music/Massive Attack/Mezzanine/03 Teardrop.mp3',
    '#EXTINF:-1,',
    'file:///Users/somebody/Music/02%20Portishead%20-%20Roads.flac',
    '#EXTINF:120,no separator here',
    '/music/untitled.mp3',
].join('\r\n');

describe('detectFormat', () => {
    it.each([
        ['an M3U header', '#EXTM3U\n#EXTINF:1,A - B\na.mp3', 'm3u'],
        ['an M3U with no header', '#EXTINF:1,A - B\na.mp3', 'm3u'],
        ['an Exportify CSV', EXPORTIFY, 'csv'],
        ['a TSV with title and artist columns', 'Title\tArtist\nTeardrop\tMassive Attack', 'csv'],
        ['a pasted list', 'Massive Attack - Teardrop\nPortishead - Roads', 'text'],
        ['a CSV with no recognisable columns', 'foo,bar\n1,2', 'text'],
    ])('reads %s as %s', (_label, text, expected) => {
        expect(detectFormat(text)).toBe(expected);
    });
});

describe('parsePlaylistText', () => {
    it('reads an Exportify CSV by its column names, quoted commas and all', () => {
        const source = parsePlaylistText(EXPORTIFY, undefined, 'late-night.csv');

        expect(source.name).toBe('late-night');
        expect(source.entries).toEqual([
            { title: 'Teardrop', artists: ['Massive Attack'], album: 'Mezzanine', isrc: 'GBAAA9800123', durationMs: 330_773 },
            { title: 'Hey, Ya!', artists: ['Outkast', 'André 3000'], album: 'Speakerboxxx', isrc: 'USAR10300924', durationMs: 235_213 },
        ]);
        expect(source.skipped).toBe(1);
        expect(source.notices).toEqual([expect.stringContaining('1 line does not name a record')]);
    });

    it('reads an M3U from its #EXTINF lines, then from a file name when there is none, and counts what it cannot read', () => {
        const source = parsePlaylistText(VLC);

        expect(source.name).toBe('Late night');
        expect(source.entries).toEqual([
            { title: 'Teardrop', artists: ['Massive Attack'], durationMs: 330_000 },
            { title: 'Roads', artists: ['Portishead'] },
        ]);
        expect(source.skipped).toBe(1);
    });

    it('reads a pasted list, numbered or not, and ignores comments and blank lines', () => {
        const source = parsePlaylistText('# my list\n\n1. Massive Attack - Teardrop\n2) Portishead – Roads\nJust a title\n');

        expect(source.name).toBe('Imported playlist');
        expect(source.entries).toEqual([
            { title: 'Teardrop', artists: ['Massive Attack'] },
            { title: 'Roads', artists: ['Portishead'] },
        ]);
        expect(source.skipped).toBe(1);
    });

    it('takes the format it is told over the one it would detect', () => {
        const source = parsePlaylistText('Title,Artist\nTeardrop,Massive Attack', 'text');

        expect(source.entries).toEqual([]);
        expect(source.skipped).toBe(2);
    });

    it('says so when a CSV has no column it recognises', () => {
        const source = parsePlaylistText('Song,Singer\nTeardrop,Massive Attack', 'csv');

        expect(source.notices).toContain('this CSV has no column the station recognises as a title or an artist');
    });

    it('rejoins a quoted cell that runs over a line break', () => {
        const source = parsePlaylistText('Title,Artist\n"Two\nLines",Somebody\nTeardrop,Massive Attack', 'csv');

        expect(source.entries.map(entry => entry.title)).toEqual(['Two\nLines', 'Teardrop']);
    });

    it('reads a clock-style duration column', () => {
        const source = parsePlaylistText('Title,Artist,Duration\nTeardrop,Massive Attack,5:30', 'csv');

        expect(source.entries[0]).toMatchObject({ durationMs: 330_000 });
    });
});

describe('splitArtistTitle', () => {
    it('splits on the first spaced dash, so a title keeps its own', () => {
        expect(splitArtistTitle('Blur - Song 2 - 2012 Remaster')).toEqual({ title: 'Song 2 - 2012 Remaster', artists: ['Blur'] });
    });

    it('leaves a hyphenated name whole', () => {
        expect(splitArtistTitle('Jay-Z - 99 Problems')).toEqual({ title: '99 Problems', artists: ['Jay-Z'] });
    });

    it('keeps a comma inside a name when the credit separates with semicolons', () => {
        expect(splitArtistTitle('Tyler, The Creator; Frank Ocean - She')).toEqual({ title: 'She', artists: ['Tyler, The Creator', 'Frank Ocean'] });
    });

    it('answers nothing for a line with no separator, or nothing either side of one', () => {
        expect(splitArtistTitle('Teardrop')).toBeUndefined();
        expect(splitArtistTitle(' - Teardrop')).toBeUndefined();
    });
});

describe('splitCsvLine', () => {
    it('honours quotes and doubled quotes', () => {
        expect(splitCsvLine('a,"b, c","d ""e""",', ',')).toEqual(['a', 'b, c', 'd "e"', '']);
    });
});
