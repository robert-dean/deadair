import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import type { JobBroker } from '@maroonedsoftware/jobbroker';
import type { Logger } from '@maroonedsoftware/logger';

import { PlaylistImportService } from '../../../src/modules/playlists/playlist.import.service.js';
import type { PlaylistImportPlanner, PlannedImport } from '../../../src/modules/playlists/playlist.import.planner.js';
import type { StationPlaylistsRepository } from '../../../src/modules/playlists/station.playlists.repository.js';
import { PLAYLIST_FILE_FORMAT } from '../../../src/modules/playlists/playlist.file.js';

const logger = { info: vi.fn(), warn: vi.fn() } as unknown as Logger;

function build(planned: PlannedImport) {
    const planner = { plan: vi.fn(async () => planned) } as unknown as PlaylistImportPlanner;
    const playlists = {
        create: vi.fn(async () => 'pl-1'),
        find: vi.fn(async () => ({
            id: 'pl-1',
            name: planned.plan.name,
            prompt: '',
            trackCount: planned.rows.length,
            resolvedCount: planned.plan.matched,
            createdAt: DateTime.utc(),
            updatedAt: DateTime.utc(),
        })),
    } as unknown as StationPlaylistsRepository;
    const jobs = { send: vi.fn(async () => 'job-1') } as unknown as JobBroker;
    return { service: new PlaylistImportService(planner, playlists, jobs, logger), playlists, jobs };
}

const file = { format: PLAYLIST_FILE_FORMAT, takenAt: 'x', name: 'Late night', tracks: [] };
const plan = (matched: number, toAdd: number, toLookUp: number): PlannedImport['plan'] => ({
    name: 'Late night',
    matched,
    toAdd,
    toLookUp,
    skipped: 0,
    entries: [],
    notices: [],
});

describe('PlaylistImportService.import', () => {
    it('writes the playlist and asks for its missing records to be looked up at once', async () => {
        const { service, playlists, jobs } = build({ plan: plan(1, 1, 1), rows: [{ trackId: 't1' }] });

        const result = await service.import({ file });

        expect(playlists.create).toHaveBeenCalledWith({ name: 'Late night', prompt: '' }, [{ trackId: 't1' }]);
        expect(jobs.send).toHaveBeenCalledWith('playlists.fill', { playlistId: 'pl-1' });
        expect(result.playlist.id).toBe('pl-1');
    });

    it('sends nothing when the library held every record', async () => {
        const { service, jobs } = build({ plan: plan(2, 0, 0), rows: [{ trackId: 't1' }, { trackId: 't2' }] });

        await service.import({ file });

        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('refuses an input that names no source', async () => {
        const { service } = build({ plan: plan(0, 0, 0), rows: [] });

        await expect(service.import({})).rejects.toMatchObject({ statusCode: 400 });
    });
});
