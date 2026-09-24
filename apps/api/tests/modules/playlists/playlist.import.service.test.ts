import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import type { JobBroker } from '@maroonedsoftware/jobbroker';
import type { Logger } from '@maroonedsoftware/logger';

import { PlaylistImportService } from '../../../src/modules/playlists/playlist.import.service.js';
import type { PlaylistImportPlanner, PlannedImport } from '../../../src/modules/playlists/playlist.import.planner.js';
import type { StationPlaylistsRepository } from '../../../src/modules/playlists/station.playlists.repository.js';
import { PLAYLIST_FILE_FORMAT } from '../../../src/modules/playlists/playlist.file.js';
import type { PlaylistsService } from '../../../src/modules/playlists/playlists.service.js';
import type { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';

const logger = { info: vi.fn(), warn: vi.fn() } as unknown as Logger;

interface Providers {
    /** Plugin id → what its `playlistIdFromUrl` answers, or a throw. */
    claims?: Record<string, (url: string) => string | undefined>;
}

function build(planned: PlannedImport, providers: Providers = {}) {
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
    const providerPlaylists = {
        getPlaylistTracks: vi.fn(async (pluginId: string, playlistId: string) => ({
            pluginId,
            playlistId,
            tracks: [{ id: 'ext-1', title: 'Roads', artists: ['Portishead'], durationMs: 305_000, isrc: 'GBAAA9400001' }],
        })),
    } as unknown as PlaylistsService;
    const records = Object.entries(providers.claims ?? {}).map(([id, claim]) => ({
        id,
        status: 'active',
        manifest: { name: id === 'deadair.spotify' ? 'Spotify' : id, capabilities: ['catalog'] },
        instance: { listPlaylists: vi.fn(), getPlaylistTracks: vi.fn(), playlistIdFromUrl: claim },
    }));
    const registry = {
        list: vi.fn(() => records),
        get: vi.fn((id: string) => records.find(record => record.id === id)),
    } as unknown as PluginRegistry;
    return {
        service: new PlaylistImportService(planner, playlists, providerPlaylists, registry, jobs, logger),
        planner,
        playlists,
        providerPlaylists,
        jobs,
    };
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

    it('refuses an input that names two sources', async () => {
        const { service } = build({ plan: plan(0, 0, 0), rows: [] });

        await expect(service.import({ file, text: 'A - B' })).rejects.toMatchObject({ statusCode: 400 });
    });
});

describe('PlaylistImportService.preview, from a provider', () => {
    it('reads a pasted link through whichever provider claims it, carrying each copy for the planner', async () => {
        const { service, planner, providerPlaylists } = build(
            { plan: plan(0, 1, 0), rows: [] },
            {
                claims: {
                    'deadair.navidrome': () => undefined,
                    'deadair.spotify': url => (url.includes('open.spotify.com') ? 'sp-list' : undefined),
                },
            },
        );

        await service.preview({ url: 'https://open.spotify.com/playlist/sp-list' });

        expect(providerPlaylists.getPlaylistTracks).toHaveBeenCalledWith('deadair.spotify', 'sp-list');
        expect(planner.plan).toHaveBeenCalledWith(
            {
                name: 'From Spotify',
                prompt: '',
                entries: [
                    {
                        title: 'Roads',
                        artists: ['Portishead'],
                        durationMs: 305_000,
                        isrc: 'GBAAA9400001',
                        origin: { pluginId: 'deadair.spotify', externalId: 'ext-1' },
                    },
                ],
                skipped: 0,
                notices: [],
                originPluginId: 'deadair.spotify',
            },
            undefined,
        );
    });

    it('refuses a link no provider claims', async () => {
        const { service } = build({ plan: plan(0, 0, 0), rows: [] }, { claims: { 'deadair.spotify': () => undefined } });

        await expect(service.preview({ url: 'https://example.com/list' })).rejects.toMatchObject({ statusCode: 422 });
    });

    it('asks the next provider when one throws reading a link', async () => {
        const { service, providerPlaylists } = build(
            { plan: plan(0, 0, 0), rows: [] },
            {
                claims: {
                    'deadair.a': () => {
                        throw new Error('bug');
                    },
                    'deadair.b': () => 'b-list',
                },
            },
        );

        await service.preview({ url: 'https://b.example/list' });

        expect(providerPlaylists.getPlaylistTracks).toHaveBeenCalledWith('deadair.b', 'b-list');
    });

    it('reads a playlist a provider lists here by its plugin and id', async () => {
        const { service, providerPlaylists } = build({ plan: plan(0, 0, 0), rows: [] });

        await service.preview({ providerPlaylist: { pluginId: 'deadair.spotify', playlistId: 'pl-9' } });

        expect(providerPlaylists.getPlaylistTracks).toHaveBeenCalledWith('deadair.spotify', 'pl-9');
    });
});
