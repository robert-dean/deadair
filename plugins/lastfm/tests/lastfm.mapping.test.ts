// What this source contributes to a merge, and — as much of the design — what it refuses to. A
// supplementary plugin that filled `year` or `imageUrl` would quietly beat the identity database on
// scalars it has no business deciding, so the declines are asserted rather than assumed.

import { describe, expect, it } from 'vitest';

import { mapAlbum, mapArtist, mapTrack, readRef, readWiki, trackRef } from '../src/lastfm.mapping.js';
import type { LastfmAlbum, LastfmArtist, LastfmTrack } from '../src/lastfm.types.js';

const WEIGHT = 10;

describe('a wiki body', () => {
    it('strips the licence footer, which would otherwise be read out on air', () => {
        const wiki = {
            summary: 'Portishead are an English band formed in 1991. <a href="https://www.last.fm/music/Portishead">Read more on Last.fm</a>.',
        };
        expect(readWiki(wiki)).toBe('Portishead are an English band formed in 1991.');
    });

    it('strips any other markup, since this reaches a prompt and then a voice', () => {
        expect(readWiki({ summary: 'Formed in <b>Bristol</b>.' })).toBe('Formed in Bristol.');
    });

    it('prefers the summary over the essay', () => {
        expect(readWiki({ summary: 'A paragraph.', content: 'Five hundred words.' })).toBe('A paragraph.');
    });

    it('answers with nothing for a body that was only a footer', () => {
        expect(readWiki({ summary: '<a href="https://www.last.fm/music/x">Read more</a>.' })).toBeUndefined();
    });

    it.each([undefined, {}, { summary: '   ' }])('answers with nothing for %s', wiki => {
        expect(readWiki(wiki)).toBeUndefined();
    });
});

describe('a track', () => {
    const track: LastfmTrack = {
        name: 'Glory Box',
        mbid: 'mb-track-1',
        url: 'https://www.last.fm/music/Portishead/_/Glory+Box',
        artist: { name: 'Portishead', mbid: 'mb-artist-1' },
        album: { title: 'Dummy', artist: 'Portishead' },
        listeners: '980000',
        playcount: '8000000',
        toptags: {
            tag: [
                { name: 'trip hop', count: 100 },
                { name: 'melancholy', count: 80 },
                { name: 'seen live', count: 60 },
            ],
        },
        wiki: { summary: 'Released as the third single from Dummy.' },
    };

    it('contributes the two vocabularies and the wiki, which is the only prose here', () => {
        const mapped = mapTrack(track, WEIGHT, true);

        expect(mapped.genres).toEqual(['trip hop']);
        expect(mapped.moods).toEqual(['melancholy']);
        expect(mapped.facts).toEqual(['Released as the third single from Dummy.']);
    });

    it('never says the listener count out loud, however large it is', () => {
        // It was a `fact` once, and on a real catalog it was seven hundred rows of "has around
        // 160,000 listeners on Last.fm" — which then beat every album and artist fact to the break,
        // since a track's own facts are preferred. It is a fact about Last.fm, not about the record.
        const mapped = mapTrack(track, WEIGHT, true);

        expect(mapped.facts?.join(' ')).not.toMatch(/listener/i);
    });

    it('says nothing at all when the wiki is the only prose and it is absent', () => {
        const mapped = mapTrack({ ...track, wiki: undefined }, WEIGHT, true);

        expect(mapped.facts).toBeUndefined();
    });

    it('keeps the counts under `extra`, which survives per provider', () => {
        const mapped = mapTrack(track, WEIGHT, true) as { extra?: Record<string, unknown> };

        expect(mapped.extra).toMatchObject({ listeners: 980_000, playcount: 8_000_000 });
        expect(mapped.extra?.tags).toContain('seen live');
    });

    it('declines everything that is identity, which MusicBrainz owns at a lower priority', () => {
        // A folksonomy correcting the identity database's release year would be the wrong way round.
        const mapped = mapTrack(track, WEIGHT, true);

        expect(mapped.year).toBeUndefined();
        expect(mapped.releaseDate).toBeUndefined();
        expect(mapped.label).toBeUndefined();
        expect(mapped.isrc).toBeUndefined();
        expect(mapped.artist).toBeUndefined();
    });

    it('never puts a track wiki in `biography`, which belongs to the artist', () => {
        // Both would land on the same merged field and the first one to arrive would win.
        expect(mapTrack(track, WEIGHT, true).biography).toBeUndefined();
    });

    it('says nothing about tags when the operator turned them off', () => {
        const mapped = mapTrack(track, WEIGHT, false);

        expect(mapped.genres).toBeUndefined();
        expect(mapped.moods).toBeUndefined();
    });

    it('answers with almost nothing for an empty response rather than throwing', () => {
        expect(mapTrack({}, WEIGHT, true)).toEqual({});
    });
});

describe('an artist', () => {
    const artist: LastfmArtist = {
        name: 'Portishead',
        mbid: 'mb-artist-1',
        url: 'https://www.last.fm/music/Portishead',
        image: [{ '#text': 'https://lastfm.freetls.fastly.net/i/u/star.png', size: 'extralarge' }],
        stats: { listeners: '2400000', playcount: '150000000' },
        tags: { tag: [{ name: 'trip hop', count: 100 }] },
        bio: { summary: 'Formed in Bristol in 1991.' },
    };

    it('contributes the biography, which is the richest thing this service has', () => {
        expect(mapArtist(artist, WEIGHT, true).biography).toBe('Formed in Bristol in 1991.');
    });

    it('contributes no facts at all, since its only candidate was the listener count', () => {
        const mapped = mapArtist(artist, WEIGHT, true) as { extra?: Record<string, unknown> };

        expect(mapped.facts).toBeUndefined();
        expect(mapped.extra).toMatchObject({ listeners: 2_400_000 });
    });

    it('NEVER fills imageUrl, because every artist answers with the same placeholder', () => {
        // The service lost the rights to artist images. Filling the field would put one identical
        // wrong picture on every artist page, and win the merge against a source with a real one.
        expect(mapArtist(artist, WEIGHT, true).imageUrl).toBeUndefined();
    });

    it('promotes the MusicBrainz id under the source the host reads it as', () => {
        expect(mapArtist(artist, WEIGHT, true).externalIds).toEqual([{ source: 'musicbrainz-artist', id: 'mb-artist-1' }]);
    });
});

describe('an album', () => {
    const album: LastfmAlbum = {
        name: 'Dummy',
        artist: 'Portishead',
        mbid: 'mb-release-1',
        image: [
            { '#text': 'https://example.com/small.png', size: 'small' },
            { '#text': 'https://example.com/large.png', size: 'extralarge' },
        ],
        tags: { tag: [{ name: 'trip hop', count: 100 }] },
        wiki: { summary: 'Released in 1994 on Go! Beat.' },
    };

    it('DOES take the cover, unlike the artist image, because album art is real', () => {
        expect(mapAlbum(album, WEIGHT, true).artworkUrl).toBe('https://example.com/large.png');
    });

    it('survives the tags arriving as a bare string, which this endpoint sometimes does', () => {
        expect(mapAlbum({ ...album, tags: 'trip hop' }, WEIGHT, true).genres).toBeUndefined();
    });
});

describe("the plugin's own reference", () => {
    it('round-trips an artist and a title that both contain spaces', () => {
        // A space separator would have made every multi-word artist unreadable.
        const ref = trackRef('Massive Attack', 'Teardrop');
        expect(readRef(ref)).toEqual({ artist: 'Massive Attack', name: 'Teardrop' });
    });

    it.each(['', 'no separator here', undefined])('declines "%s", which is not one', ref => {
        expect(readRef(ref)).toBeUndefined();
    });
});
