import { describe, expect, it } from 'vitest';

import { ytmusicPlaylistIdFromUrl } from '../src/ytmusic.mapping.js';

describe('ytmusicPlaylistIdFromUrl', () => {
    it.each([
        ['a YouTube Music playlist', 'https://music.youtube.com/playlist?list=PLabc123_-x', 'PLabc123_-x'],
        ['an album playlist', 'https://music.youtube.com/playlist?list=OLAK5uy_abc', 'OLAK5uy_abc'],
        ['a watch page opened inside a playlist', 'https://music.youtube.com/watch?v=xyz&list=PLabc123', 'PLabc123'],
        ['a YouTube playlist', 'https://www.youtube.com/playlist?list=PLabc123', 'PLabc123'],
        ['a browse id, kept as written', 'https://music.youtube.com/playlist?list=VLPLabc123', 'VLPLabc123'],
    ])('reads %s', (_label, url, id) => {
        expect(ytmusicPlaylistIdFromUrl(url)).toBe(id);
    });

    it.each([
        ['a watch page with no playlist', 'https://music.youtube.com/watch?v=xyz'],
        ['a channel', 'https://music.youtube.com/channel/UCabc'],
        ['another site', 'https://example.com/playlist?list=PLabc123'],
        ['a Spotify link', 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'],
    ])('does not claim %s', (_label, url) => {
        expect(ytmusicPlaylistIdFromUrl(url)).toBeUndefined();
    });
});
