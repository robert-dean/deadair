// Pandora's annotations as the station's tracks, read from a recorded `annotateObjects` answer, and
// the playlist links an operator might paste.

import { describe, expect, it } from 'vitest';

import { annotationsOf, mapPlaylist, mapTrack, pandoraPlaylistIdFromUrl } from '../src/pandora.mapping.js';
import { fixture } from './pandora.fake.js';

const annotated = annotationsOf(fixture('annotate.objects').body);

describe('mapTrack', () => {
    it('reads a recorded track whole, ISRC included', () => {
        expect(mapTrack('TR:47617', annotated)).toEqual({
            id: 'TR:47617',
            title: 'No Surprises',
            artists: ['Radiohead'],
            album: 'OK Computer',
            durationMs: 229_120,
            isrc: 'GBAYE9700386',
            artworkUrl: 'https://content-images.p-cdn.com/images/b3/a9/46/6c/75054460b58f2a55e151db9a/_500W_500H.jpg',
            year: 1997,
            trackNumber: 10,
        });
    });

    it('is nothing for an id that is not a track', () => {
        expect(mapTrack('AL:3807', annotated)).toBeUndefined();
        expect(mapTrack('TR:missing', annotated)).toBeUndefined();
    });

    it('marks an explicit record, and says nothing for one Pandora calls NONE', () => {
        expect(mapTrack('TR:1', { 'TR:1': { name: 'A', explicitness: 'EXPLICIT' } })?.advisory).toBe('explicit');
        expect(mapTrack('TR:1', { 'TR:1': { name: 'A', explicitness: 'CLEAN' } })?.advisory).toBe('clean');
        expect(mapTrack('TR:1', { 'TR:1': { name: 'A', explicitness: 'NONE' } })).not.toHaveProperty('advisory');
    });

    it('falls back to whole seconds when Pandora gave no milliseconds', () => {
        expect(mapTrack('TR:1', { 'TR:1': { name: 'A', duration: 200 } })?.durationMs).toBe(200_000);
    });
});

describe('annotationsOf', () => {
    it('reads the map whether or not it is wrapped', () => {
        expect(annotationsOf({ annotations: { 'TR:1': { name: 'A' } } })).toEqual({ 'TR:1': { name: 'A' } });
        expect(annotationsOf({ 'TR:1': { name: 'A' } })).toEqual({ 'TR:1': { name: 'A' } });
        expect(annotationsOf(undefined)).toEqual({});
    });
});

describe('mapPlaylist', () => {
    it('reports what Pandora said and that the account can read it', () => {
        expect(mapPlaylist('PL:1:2', { name: 'Drive', totalTracks: 30 })).toEqual({ id: 'PL:1:2', name: 'Drive', trackCount: 30, permissions: ['read'] });
    });

    it('never drops a playlist it could not describe', () => {
        expect(mapPlaylist('PL:1:2', undefined, 'From the list')).toMatchObject({ id: 'PL:1:2', name: 'From the list' });
        expect(mapPlaylist('PL:1:2', undefined)).toMatchObject({ id: 'PL:1:2', name: 'PL:1:2' });
    });
});

describe('pandoraPlaylistIdFromUrl', () => {
    it.each([
        ['https://www.pandora.com/playlist/PL:844424994606591:1745910464', 'PL:844424994606591:1745910464'],
        ['https://pandora.com/playlist/PL%3A844424994606591%3A1745910464', 'PL:844424994606591:1745910464'],
        ['  https://www.pandora.com/playlist/PL:1:2?shareImp=true  ', 'PL:1:2'],
    ])('reads %s', (url, id) => {
        expect(pandoraPlaylistIdFromUrl(url)).toBe(id);
    });

    it.each([
        'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
        'https://www.pandora.com/artist/radiohead/ok-computer/ALlntvzkZt3vk3X',
        'https://evil.example/playlist/PL:1:2',
        'https://pandora.com.evil.example/playlist/PL:1:2',
        'not a url',
    ])('leaves %s to whoever owns it', url => {
        expect(pandoraPlaylistIdFromUrl(url)).toBeUndefined();
    });
});
