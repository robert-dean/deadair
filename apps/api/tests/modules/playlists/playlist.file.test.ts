// A file is keyed by words and ISRC, never by this station's ids, and a placeholder carries the copy
// it came from. The round trip below is what makes an exported playlist import back onto the same
// records.

import { describe, expect, it } from 'vitest';
import { entriesOfFile, fileTrackOf, PLAYLIST_FILE_FORMAT } from '../../../src/modules/playlists/playlist.file.js';
import type { StationPlaylistRowTrack } from '../../../src/modules/playlists/station.playlists.repository.js';
import type { PlaylistFile } from '../../../src/modules/playlists/types/station.playlists.types.js';

const resolved: StationPlaylistRowTrack = {
    id: 'row-1',
    position: 0,
    trackId: 'track-1',
    title: 'Teardrop',
    artists: ['Massive Attack', 'Elizabeth Fraser'],
    album: 'Mezzanine',
    durationMs: 330_000,
    isrc: 'GBAAA9800123',
    artistId: 'artist-1',
    albumId: 'album-1',
};

const placeholder: StationPlaylistRowTrack = {
    id: 'row-2',
    position: 1,
    title: 'Roads',
    artists: ['Portishead'],
    originPluginId: 'deadair.spotify',
    originExternalId: 'sp-1',
};

const file = (overrides: Partial<PlaylistFile> = {}): PlaylistFile => ({
    format: PLAYLIST_FILE_FORMAT,
    takenAt: '2026-09-24T12:00:00.000Z',
    name: 'Late night',
    tracks: [],
    ...overrides,
});

describe('fileTrackOf', () => {
    it('writes a resolved row by its words and ISRC, with none of this station ids', () => {
        const track = fileTrackOf(resolved);

        expect(track).toEqual({
            title: 'Teardrop',
            artists: ['Massive Attack', 'Elizabeth Fraser'],
            album: 'Mezzanine',
            durationMs: 330_000,
            isrc: 'GBAAA9800123',
        });
        expect(JSON.stringify(track)).not.toMatch(/track-1|artist-1|album-1|row-1/);
    });

    it('carries a placeholder copy verbatim so it can still resolve on the far side', () => {
        expect(fileTrackOf(placeholder)).toEqual({
            title: 'Roads',
            artists: ['Portishead'],
            origin: { pluginId: 'deadair.spotify', externalId: 'sp-1' },
        });
    });
});

describe('entriesOfFile', () => {
    it('reads back what fileTrackOf wrote', () => {
        const source = entriesOfFile(file({ prompt: 'After midnight', tracks: [fileTrackOf(resolved), fileTrackOf(placeholder)] }));

        expect(source).toEqual({
            name: 'Late night',
            prompt: 'After midnight',
            skipped: 0,
            notices: [],
            entries: [
                { title: 'Teardrop', artists: ['Massive Attack', 'Elizabeth Fraser'], album: 'Mezzanine', durationMs: 330_000, isrc: 'GBAAA9800123' },
                { title: 'Roads', artists: ['Portishead'], origin: { pluginId: 'deadair.spotify', externalId: 'sp-1' } },
            ],
        });
    });

    it('refuses a document that is not a playlist file', () => {
        expect(() => entriesOfFile(file({ format: 'deadair.personas/1' }))).toThrow(expect.objectContaining({ statusCode: 422 }));
    });

    it('refuses a playlist file from a later build rather than reading it wrongly', () => {
        expect(() => entriesOfFile(file({ format: 'deadair.playlist/2' }))).toThrow(expect.objectContaining({ statusCode: 422 }));
    });
});
