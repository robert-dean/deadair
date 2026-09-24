// A fill is discovery on the station's existing terms: the library first, then the copy a row was
// cloned from, then a strict search, and every hit ingested as `discovered`. What is tested here is
// that ladder, the switch that gates all of it, and that one bad row costs that row alone.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { ProviderTrack } from '@deadair/plugin-sdk';

import { MAX_FILL_LOOKUPS, PlaylistFillService } from '../../../src/modules/playlists/playlist.fill.service.js';
import type { PlaylistPlaceholderRow, StationPlaylistsRepository } from '../../../src/modules/playlists/station.playlists.repository.js';
import type { CatalogPlaceholderRepository } from '../../../src/modules/catalog/ingest/catalog.placeholder.repository.js';
import type { CatalogResolverRepository } from '../../../src/modules/catalog/ingest/catalog.resolver.repository.js';
import type { CatalogResolverService } from '../../../src/modules/catalog/ingest/catalog.resolver.service.js';
import type { ProviderTrackLookup } from '../../../src/modules/director/provider.track.lookup.js';
import type { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { settingsConfig } from '../../utils/settings.config.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

interface World {
    rows: PlaylistPlaceholderRow[];
    settings?: Record<string, string>;
    /** Title → track id, for rows the library now holds. */
    held?: Record<string, string>;
    /** What the origin plugin answers for one of its ids. */
    copies?: Record<string, ProviderTrack>;
    /** Whether the origin plugin is installed, active and can be asked for one track. */
    originAvailable?: boolean;
    /** Title → a copy some provider has, found by search. */
    searchable?: Record<string, { pluginId: string; track: ProviderTrack }>;
    /** Titles whose search throws. */
    searchFails?: string[];
}

function build(world: World) {
    const resolved: { id: string; trackId: string }[] = [];
    const ingested: { pluginId: string; track: ProviderTrack; origin: string }[] = [];

    const playlists = { placeholders: vi.fn(async () => world.rows) } as unknown as StationPlaylistsRepository;
    const placeholders = {
        resolve: vi.fn(async (id: string, trackId: string) => {
            resolved.push({ id, trackId });
            return true;
        }),
    } as unknown as CatalogPlaceholderRepository;
    const library = {
        findTrackSource: vi.fn(async () => undefined),
        findTrack: vi.fn(async (identity: { title: string }) => world.held?.[identity.title]),
    } as unknown as CatalogResolverRepository;
    const ingest = {
        ingestTrack: vi.fn(async (pluginId: string, track: ProviderTrack, origin: string) => {
            ingested.push({ pluginId, track, origin });
            return { status: 'ingested', trackId: `new-${track.id}`, created: true };
        }),
    } as unknown as CatalogResolverService;
    const lookup = {
        find: vi.fn(async (title: string) => {
            if (world.searchFails?.includes(title)) throw new Error('provider down');
            return world.searchable?.[title];
        }),
    } as unknown as ProviderTrackLookup;
    const instance = {
        listPlaylists: vi.fn(),
        getPlaylistTracks: vi.fn(),
        getTrack: vi.fn(async (id: string) => world.copies?.[id]),
    };
    const registry = {
        get: vi.fn(() =>
            world.originAvailable === false
                ? undefined
                : { id: 'deadair.spotify', status: 'active', manifest: { capabilities: ['catalog'] }, instance },
        ),
    } as unknown as PluginRegistry;
    const invoker = { invoke: vi.fn(async (_id: string, _op: string, call: () => Promise<unknown>) => call()) } as unknown as PluginInvoker;
    const { config } = settingsConfig(world.settings ?? {});

    const service = new PlaylistFillService(playlists, placeholders, library, ingest, lookup, registry, invoker, config, logger);
    return { service, resolved, ingested, lookup, instance };
}

const track = (id: string, title: string, artist: string): ProviderTrack => ({ id, title, artists: [artist] });

describe('PlaylistFillService.fill', () => {
    it('takes a row the library has gained since the import without asking any provider', async () => {
        const { service, resolved, lookup, ingested } = build({
            rows: [{ id: 'row-1', position: 0, snapshot: { title: 'Teardrop', artists: ['Massive Attack'] } }],
            held: { Teardrop: 'track-1' },
        });

        await expect(service.fill('pl')).resolves.toEqual({ filled: 1, missed: 0, remaining: 0 });
        expect(resolved).toEqual([{ id: 'row-1', trackId: 'track-1' }]);
        expect(lookup.find).not.toHaveBeenCalled();
        expect(ingested).toEqual([]);
    });

    it('asks the plugin a row was cloned from for that exact copy, and ingests it as discovered', async () => {
        const { service, resolved, ingested, lookup } = build({
            rows: [
                {
                    id: 'row-1',
                    position: 0,
                    origin: { pluginId: 'deadair.spotify', externalId: 'sp-1' },
                    snapshot: { title: 'Roads', artists: ['Portishead'] },
                },
            ],
            copies: { 'sp-1': track('sp-1', 'Roads', 'Portishead') },
        });

        await expect(service.fill('pl')).resolves.toEqual({ filled: 1, missed: 0, remaining: 0 });
        expect(ingested).toEqual([{ pluginId: 'deadair.spotify', track: track('sp-1', 'Roads', 'Portishead'), origin: 'discovered' }]);
        expect(resolved).toEqual([{ id: 'row-1', trackId: 'new-sp-1' }]);
        expect(lookup.find).not.toHaveBeenCalled();
    });

    it('searches by title and lead artist when the origin plugin is not installed here', async () => {
        const { service, ingested, lookup } = build({
            rows: [
                {
                    id: 'row-1',
                    position: 0,
                    origin: { pluginId: 'deadair.spotify', externalId: 'sp-1' },
                    snapshot: { title: 'Roads', artists: ['Portishead', 'Somebody'] },
                },
            ],
            originAvailable: false,
            searchable: { Roads: { pluginId: 'deadair.navidrome', track: track('nd-1', 'Roads', 'Portishead') } },
        });

        await expect(service.fill('pl')).resolves.toMatchObject({ filled: 1, missed: 0 });
        expect(lookup.find).toHaveBeenCalledWith('Roads', 'Portishead');
        expect(ingested[0]).toMatchObject({ pluginId: 'deadair.navidrome', origin: 'discovered' });
    });

    it('searches for a row read from a file, which names no copy at all', async () => {
        const { service, resolved } = build({
            rows: [{ id: 'row-1', position: 0, snapshot: { title: 'Angel', artists: ['Massive Attack'] } }],
            searchable: { Angel: { pluginId: 'deadair.spotify', track: track('sp-9', 'Angel', 'Massive Attack') } },
        });

        await expect(service.fill('pl')).resolves.toMatchObject({ filled: 1 });
        expect(resolved).toEqual([{ id: 'row-1', trackId: 'new-sp-9' }]);
    });

    it('counts a row nothing has as a miss and leaves it a placeholder', async () => {
        const { service, resolved, ingested } = build({
            rows: [{ id: 'row-1', position: 0, snapshot: { title: 'Nowhere', artists: ['Nobody'] } }],
        });

        await expect(service.fill('pl')).resolves.toEqual({ filled: 0, missed: 1, remaining: 0 });
        expect(resolved).toEqual([]);
        expect(ingested).toEqual([]);
    });

    it('keeps going past a row whose search throws', async () => {
        const { service, resolved } = build({
            rows: [
                { id: 'row-1', position: 0, snapshot: { title: 'Broken', artists: ['A'] } },
                { id: 'row-2', position: 1, snapshot: { title: 'Angel', artists: ['Massive Attack'] } },
            ],
            searchFails: ['Broken'],
            searchable: { Angel: { pluginId: 'deadair.spotify', track: track('sp-9', 'Angel', 'Massive Attack') } },
        });

        await expect(service.fill('pl')).resolves.toEqual({ filled: 1, missed: 1, remaining: 0 });
        expect(resolved).toEqual([{ id: 'row-2', trackId: 'new-sp-9' }]);
    });

    it('looks nothing up when the station may not add records to its library', async () => {
        // A setting is a STRING, so the off case is tested with the string.
        const { service, lookup } = build({
            rows: [{ id: 'row-1', position: 0, snapshot: { title: 'Angel', artists: ['Massive Attack'] } }],
            settings: { 'rotation.discover': 'false' },
        });

        await expect(service.fill('pl')).resolves.toEqual({ filled: 0, missed: 0, remaining: 1, refused: 'discover-off' });
        expect(lookup.find).not.toHaveBeenCalled();
    });

    it('leaves whatever is past the ceiling for the next run', async () => {
        const rows = Array.from({ length: MAX_FILL_LOOKUPS + 3 }, (_, n) => ({
            id: `row-${n}`,
            position: n,
            snapshot: { title: `R${n}`, artists: ['A'] },
        }));
        const { service, lookup } = build({ rows });

        await expect(service.fill('pl')).resolves.toEqual({ filled: 0, missed: MAX_FILL_LOOKUPS, remaining: 3 });
        expect(lookup.find).toHaveBeenCalledTimes(MAX_FILL_LOOKUPS);
    });
});
