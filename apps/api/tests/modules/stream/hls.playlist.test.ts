// `GET /hls/{name}` is anonymous, reachable by anyone who can reach the station, and
// reads a file from a directory by the name it was handed. So the whole of what this
// file is for is the refusals: every way a name could name something outside the
// directory has to be one, and a name that is merely absent has to be indistinguishable
// from one that was refused.

import { describe, expect, it } from 'vitest';

import { hlsPlaylistPath } from '../../../src/modules/stream/hls.playlist.js';

const DIR = '/data/streamhls';

describe('hlsPlaylistPath', () => {
    it('accepts the playlists Liquidsoap actually writes', () => {
        // The master and one media playlist per stream, named after the stream.
        expect(hlsPlaylistPath(DIR, 'live.m3u8')).toBe('/data/streamhls/live.m3u8');
        expect(hlsPlaylistPath(DIR, 'live_aac.m3u8')).toBe('/data/streamhls/live_aac.m3u8');
        expect(hlsPlaylistPath(DIR, 'aac-128.m3u8')).toBe('/data/streamhls/aac-128.m3u8');
    });

    it('refuses anything that would leave the directory', () => {
        // The reason the name is validated rather than sanitised: stripping separators
        // is a guess at what the caller meant, and this needs no guess at all — a name
        // that is not a flat filename is not a playlist this station has.
        for (const name of ['../secrets.m3u8', '../../etc/passwd.m3u8', '/etc/passwd.m3u8', 'a/b.m3u8', 'a\\b.m3u8', '..%2Fx.m3u8']) {
            expect(hlsPlaylistPath(DIR, name)).toBeUndefined();
        }
    });

    it('refuses a name that is only an extension, or starts with a dot', () => {
        // `.m3u8` and `..m3u8` are not files anybody writes here, and a leading dot is
        // the half of `..` that a naive check misses.
        expect(hlsPlaylistPath(DIR, '.m3u8')).toBeUndefined();
        expect(hlsPlaylistPath(DIR, '..m3u8')).toBeUndefined();
    });

    it('refuses anything that is not a playlist', () => {
        // The segments are nginx's to serve, off the same directory. Serving them here
        // too would put the station's audio through Node and, worse, would make every
        // segment request look like a heartbeat and multiply one listener into a crowd.
        for (const name of ['live.ts', 'live.mp4', 'radio.env', 'icecast.xml', 'live.m3u8.bak', '']) {
            expect(hlsPlaylistPath(DIR, name)).toBeUndefined();
        }
    });

    it('is case-sensitive about the extension', () => {
        // Nothing writes `.M3U8`, so accepting it would only ever widen the surface.
        expect(hlsPlaylistPath(DIR, 'live.M3U8')).toBeUndefined();
    });

    it('refuses a name carrying a null byte or a trailing newline', () => {
        // The null byte is the classic truncation trick, which `join` would carry through
        // happily. The newline is the one an anchored pattern gets wrong on its own:
        // JavaScript's `$` also matches BEFORE a trailing newline, so `live.m3u8\n` would
        // satisfy a regex that looks as though it could not.
        expect(hlsPlaylistPath(DIR, 'live.m3u8\0.txt')).toBeUndefined();
        expect(hlsPlaylistPath(DIR, 'live.m3u8\n')).toBeUndefined();
    });
});
