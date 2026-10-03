// A provider's id becomes a library record by the cheapest route that is exact: the binding the
// library already has, else the copy that plugin hands back, taken in as `discovered`. What is tested
// here is that order, and that a plugin which cannot answer is a miss rather than a thrown request.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { ProviderTrack } from '@deadair/plugin-sdk';

import { ProviderCopyResolver } from '../../../../src/modules/catalog/ingest/provider.copy.resolver.js';
import type { CatalogResolverRepository } from '../../../../src/modules/catalog/ingest/catalog.resolver.repository.js';
import type { CatalogResolverService } from '../../../../src/modules/catalog/ingest/catalog.resolver.service.js';
import type { PluginRegistry } from '../../../../src/modules/plugins/plugin.registry.js';
import type { PluginInvoker } from '../../../../src/modules/plugins/plugin.invoker.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const copy: ProviderTrack = { id: 'sp-1', title: 'Blueberry Hill', artists: ['Fats Domino'] };

function build(world: { bound?: string; copies?: Record<string, ProviderTrack>; plugin?: 'absent' | 'no-getTrack' | 'throws'; skipped?: boolean }) {
    const library = { findTrackSource: vi.fn(async () => world.bound) } as unknown as CatalogResolverRepository;
    const ingestTrack = vi.fn(async (_pluginId: string, track: ProviderTrack) =>
        world.skipped ? { status: 'skipped', reason: 'no-artist' } : { status: 'ingested', trackId: `new-${track.id}`, created: true },
    );
    const ingest = { ingestTrack } as unknown as CatalogResolverService;
    const getTrack = vi.fn(async (id: string) => {
        if (world.plugin === 'throws') throw new Error('rate limited');
        return world.copies?.[id];
    });
    const instance =
        world.plugin === 'no-getTrack'
            ? { listPlaylists: vi.fn(), getPlaylistTracks: vi.fn() }
            : { listPlaylists: vi.fn(), getPlaylistTracks: vi.fn(), getTrack };
    const registry = {
        get: vi.fn(() =>
            world.plugin === 'absent' ? undefined : { id: 'deadair.spotify', status: 'active', manifest: { capabilities: ['catalog'] }, instance },
        ),
    } as unknown as PluginRegistry;
    const invoke = vi.fn(async (_id: string, _op: string, call: () => Promise<unknown>) => call());
    const invoker = { invoke } as unknown as PluginInvoker;
    return { resolver: new ProviderCopyResolver(library, ingest, registry, invoker, logger), ingestTrack, getTrack, invoke };
}

describe('ProviderCopyResolver', () => {
    it('answers with the binding the library already has without asking the provider', async () => {
        const { resolver, getTrack, ingestTrack } = build({ bound: 'track-1', copies: { 'sp-1': copy } });
        expect(await resolver.resolve('deadair.spotify', 'sp-1', 'test')).toBe('track-1');
        expect(getTrack).not.toHaveBeenCalled();
        expect(ingestTrack).not.toHaveBeenCalled();
    });

    it('takes a new copy in as discovered, through the invoker under the caller name', async () => {
        const { resolver, ingestTrack, invoke } = build({ copies: { 'sp-1': copy } });
        expect(await resolver.resolve('deadair.spotify', 'sp-1', 'requests.create.getTrack')).toBe('new-sp-1');
        expect(ingestTrack).toHaveBeenCalledWith('deadair.spotify', copy, 'discovered');
        expect(invoke.mock.calls[0]?.[1]).toBe('requests.create.getTrack');
    });

    it('is a miss when the provider no longer has the record', async () => {
        const { resolver, ingestTrack } = build({ copies: {} });
        expect(await resolver.resolve('deadair.spotify', 'sp-1', 'test')).toBeUndefined();
        expect(ingestTrack).not.toHaveBeenCalled();
    });

    it('is a miss when the plugin is not here, cannot be asked for one track, or fails', async () => {
        for (const plugin of ['absent', 'no-getTrack', 'throws'] as const) {
            const { resolver } = build({ plugin, copies: { 'sp-1': copy } });
            expect(await resolver.resolve('deadair.spotify', 'sp-1', 'test')).toBeUndefined();
        }
    });

    it('is a miss when the copy names nobody the library could file it under', async () => {
        const { resolver } = build({ copies: { 'sp-1': copy }, skipped: true });
        expect(await resolver.resolve('deadair.spotify', 'sp-1', 'test')).toBeUndefined();
    });
});
