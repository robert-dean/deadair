// The operator's side of the vocal markers: a correction wins over the lyrics, is held to a shape
// that makes sense, and clearing it hands the record back to its lyrics. Never a word of the lyric.

import { describe, expect, it, vi } from 'vitest';

import type { StoredTiming, VocalOverride } from '../../../src/modules/lyrics/lyrics.repository.js';
import { VocalMarkersReader } from '../../../src/modules/lyrics/vocal.markers.reader.js';
import { VocalMarkersService } from '../../../src/modules/lyrics/vocal.markers.service.js';
import { settingsConfig } from '../../utils/settings.config.js';

const TRACK = '00000000-0000-0000-0000-000000000001';

const build = (timings: StoredTiming[] = [], exists = true) => {
    const overrides = new Map<string, VocalOverride>();
    const lyrics = {
        timingsForTracks: vi.fn(async () => timings),
        overridesForTracks: vi.fn(
            async (ids: readonly string[]) => new Map(ids.flatMap(id => (overrides.has(id) ? [[id, overrides.get(id)!] as const] : []))),
        ),
        saveOverride: vi.fn(async (id: string, override: VocalOverride) => void overrides.set(id, override)),
        clearOverride: vi.fn(async (id: string) => (overrides.delete(id) ? 1 : 0)),
    };
    const tracks = { findTrack: vi.fn(async () => (exists ? { id: TRACK } : undefined)) };
    const reader = new VocalMarkersReader(lyrics as never, settingsConfig().config);
    return { service: new VocalMarkersService(tracks as never, lyrics as never, reader), lyrics };
};

const synced: StoredTiming = {
    trackId: TRACK,
    provider: 'deadair.lrclib',
    instrumental: false,
    synced: [
        { atMs: 15_900, text: 'first words' },
        { atMs: 18_000, text: 'more words' },
    ],
};

describe('VocalMarkersService', () => {
    it('reads the lyrics’ markers, and says that is where they came from', async () => {
        const detail = await build([synced]).service.getVocalMarkers(TRACK);

        expect(detail).toEqual({ trackId: TRACK, kind: 'ranges', onsetMs: 15_900, endMs: 22_000, source: 'lyrics' });
        expect(JSON.stringify(detail)).not.toContain('words');
    });

    it('says there is nothing to go on for a record with no timed lyrics', async () => {
        expect(await build().service.getVocalMarkers(TRACK)).toEqual({ trackId: TRACK, kind: 'unknown', source: 'none' });
    });

    it('lets an operator’s correction win, keeping the lyrics’ end when none is given', async () => {
        const { service } = build([synced]);

        expect(await service.setVocalMarkers(TRACK, { instrumental: false, onsetMs: 12_000 })).toEqual({
            trackId: TRACK,
            kind: 'ranges',
            onsetMs: 12_000,
            endMs: 22_000,
            source: 'override',
        });
    });

    it('takes an early onset from an operator, which it would not take from a lyric', async () => {
        expect(await build().service.setVocalMarkers(TRACK, { instrumental: false, onsetMs: 500 })).toMatchObject({ kind: 'ranges', onsetMs: 500 });
    });

    it('lets an operator call a record instrumental', async () => {
        expect(await build([synced]).service.setVocalMarkers(TRACK, { instrumental: true })).toEqual({
            trackId: TRACK,
            kind: 'instrumental',
            source: 'override',
        });
    });

    it('hands the record back to its lyrics when the correction is cleared', async () => {
        const { service } = build([synced]);
        await service.setVocalMarkers(TRACK, { instrumental: true });

        expect(await service.clearVocalMarkers(TRACK)).toMatchObject({ kind: 'ranges', onsetMs: 15_900, source: 'lyrics' });
    });

    it('refuses a correction that says nothing', async () => {
        await expect(build().service.setVocalMarkers(TRACK, { instrumental: false })).rejects.toMatchObject({ statusCode: 400 });
    });

    it('refuses an end that is not after the onset', async () => {
        await expect(build().service.setVocalMarkers(TRACK, { instrumental: false, onsetMs: 10_000, endMs: 9_000 })).rejects.toMatchObject({
            statusCode: 400,
        });
    });

    it('answers 404 for a record the catalog does not hold', async () => {
        await expect(build([], false).service.getVocalMarkers(TRACK)).rejects.toMatchObject({ statusCode: 404 });
    });
});
