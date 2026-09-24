import { describe, expect, it } from 'vitest';

import { navidromePlaylistIdFromUrl } from '../src/navidrome.mapping.js';

describe('navidromePlaylistIdFromUrl', () => {
    it('reads a link into the configured server', () => {
        expect(navidromePlaylistIdFromUrl('https://music.example.net/app/#/playlist/4f2c-99/show', 'https://music.example.net')).toBe('4f2c-99');
    });

    it('reads one where the server is served under a path', () => {
        expect(navidromePlaylistIdFromUrl('http://nas.local:4533/navidrome/app/#/playlist/abc', 'http://nas.local:4533/navidrome/')).toBe('abc');
    });

    it.each([
        ['another server', 'https://other.example.net/app/#/playlist/abc/show'],
        ['the same host on another port', 'https://music.example.net:8443/app/#/playlist/abc/show'],
        ['an album page', 'https://music.example.net/app/#/album/abc/show'],
        ['not a URL', 'abc'],
    ])('does not claim %s', (_label, url) => {
        expect(navidromePlaylistIdFromUrl(url, 'https://music.example.net')).toBeUndefined();
    });

    it('claims nothing before it is configured', () => {
        expect(navidromePlaylistIdFromUrl('https://music.example.net/app/#/playlist/abc/show', undefined)).toBeUndefined();
    });
});
