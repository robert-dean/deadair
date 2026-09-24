import { describe, expect, it } from 'vitest';

import { spotifyPlaylistIdFromUrl } from '../src/spotify.mapping.js';

const ID = '37i9dQZF1DXcBWIGoYBM5M';

describe('spotifyPlaylistIdFromUrl', () => {
    it.each([
        ['a share link with its tracking query', `https://open.spotify.com/playlist/${ID}?si=abc123`],
        ['a localised link', `https://open.spotify.com/intl-de/playlist/${ID}`],
        ['a regional localised link', `https://open.spotify.com/intl-pt-BR/playlist/${ID}`],
        ['an embed link', `https://open.spotify.com/embed/playlist/${ID}`],
        ['a URI', `spotify:playlist:${ID}`],
        ['one with whitespace around it', `  https://open.spotify.com/playlist/${ID}  `],
    ])('reads %s', (_label, url) => {
        expect(spotifyPlaylistIdFromUrl(url)).toBe(ID);
    });

    it.each([
        ['an album', `https://open.spotify.com/album/${ID}`],
        ['a track URI', `spotify:track:${ID}`],
        ['another site', `https://example.com/playlist/${ID}`],
        ['a malformed id', 'https://open.spotify.com/playlist/short'],
        ['not a URL at all', 'Massive Attack - Teardrop'],
    ])('does not claim %s', (_label, url) => {
        expect(spotifyPlaylistIdFromUrl(url)).toBeUndefined();
    });
});
