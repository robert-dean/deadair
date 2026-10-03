// The reader: one batched read, sources believed in the operator's order, and markers out.

import { describe, expect, it, vi } from 'vitest';

import { LYRICS_KEYS } from '../../../src/modules/lyrics/lyrics.keys.js';
import type { StoredTiming } from '../../../src/modules/lyrics/lyrics.repository.js';
import { VocalMarkersReader } from '../../../src/modules/lyrics/vocal.markers.reader.js';
import { settingsConfig } from '../../utils/settings.config.js';

const build = (rows: StoredTiming[], settings: Record<string, string> = {}) => {
    const repository = { timingsForTracks: vi.fn(async () => rows) };
    return { reader: new VocalMarkersReader(repository as never, settingsConfig(settings).config), repository };
};

describe('VocalMarkersReader', () => {
    it('asks nothing for no records', async () => {
        const { reader, repository } = build([]);
        expect((await reader.forTracks([])).size).toBe(0);
        expect(repository.timingsForTracks).not.toHaveBeenCalled();
    });

    it('answers every record asked about, unknown where nothing is held, in one read', async () => {
        const { reader, repository } = build([
            { trackId: 't1', provider: 'deadair.lrclib', instrumental: false, synced: [{ atMs: 12_000, text: 'sung' }] },
        ]);

        const markers = await reader.forTracks(['t1', 't2', 't1']);

        expect(repository.timingsForTracks).toHaveBeenCalledWith(['t1', 't2']);
        expect(markers.get('t1')).toMatchObject({ kind: 'ranges', onsetMs: 12_000 });
        expect(markers.get('t2')).toEqual({ kind: 'unknown' });
    });

    it('believes the source the operator listed first', async () => {
        const rows: StoredTiming[] = [
            { trackId: 't1', provider: 'a.source', instrumental: false, synced: [{ atMs: 9_000, text: 'sung' }] },
            { trackId: 't1', provider: 'b.source', instrumental: false, synced: [{ atMs: 14_000, text: 'sung' }] },
        ];

        expect((await build(rows).reader.forTracks(['t1'])).get('t1')).toMatchObject({ onsetMs: 9_000 });
        expect(
            (await build(rows, { [LYRICS_KEYS.providerOrder]: JSON.stringify([{ source: 'b.source' }]) }).reader.forTracks(['t1'])).get('t1'),
        ).toMatchObject({
            onsetMs: 14_000,
        });
    });
});
