// The gathering half of the attention list. The composition next door is covered by
// `station.attention.test.ts`; what is worth pinning HERE is which facts get handed to it, and above
// all the one this file was written for: a plugin that streams is not a plugin that uses the
// station's own track fetcher, and reading the wrong one of those puts a `failure` on a station with
// nothing wrong with it.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { StationAttentionService } from '../../../src/modules/station/station.attention.service.js';
import type { TracksRepository } from '../../../src/modules/catalog/tracks.repository.js';
import type { DirectorConsoleService } from '../../../src/modules/director/director.console.service.js';
import type { PlayoutService } from '../../../src/modules/playout/playout.service.js';
import type { PluginsService } from '../../../src/modules/plugins/plugins.service.js';
import type { FetcherAuthorizationState, SpotifyShimClient } from '../../../src/modules/stream/spotify.shim.client.js';
import { resetForwardedHop } from '../../../src/modules/shared/forwarded.reading.js';

const quiet = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const airing = {
    audible: true,
    cause: 'airing',
    detail: 'The station is holding the mount and its programme is going out.',
    checks: [],
};

/** A library with records in it and nothing benched, so the only row under test is the fetcher's. */
const counts = { total: 900, cached: 900, measured: 900, enriched: 900, benched: 0, failing: 0 };

/**
 * One installed plugin, as the plugins service summarises it.
 *
 * Only the four fields this service reads are set. The cast is what keeps the fixture from carrying
 * fifteen more that no assertion here is about.
 */
function plugin(over: { id: string; name: string; capabilities: string[]; usesTrackFetcher?: boolean }) {
    return { ...over, enabled: true, status: 'active' };
}

/** The shim answering as it does in the production image: up, and holding no login of its own. */
const unauthorized: FetcherAuthorizationState = { reachable: true, configured: true, authorized: false, session: false };

function service(over: { plugins?: unknown[]; authorization?: FetcherAuthorizationState } = {}) {
    const playout = { getStatus: () => Promise.resolve({ silence: airing }) } as unknown as PlayoutService;
    const director = { getOrder: () => Promise.resolve({ items: [] }) } as unknown as DirectorConsoleService;
    const tracks = {
        trackStateCounts: () => Promise.resolve(counts),
        faultingTracks: () => Promise.resolve([]),
        faultsForTracks: () => Promise.resolve([]),
    } as unknown as TracksRepository;
    const plugins = { listPlugins: () => Promise.resolve(over.plugins ?? []) } as unknown as PluginsService;
    const fetcher = { authorization: () => Promise.resolve(over.authorization ?? unauthorized) } as unknown as SpotifyShimClient;

    return new StationAttentionService(playout, director, tracks, plugins, fetcher, quiet);
}

describe('StationAttentionService.read', () => {
    it('answers with nothing for a station that is working', async () => {
        resetForwardedHop();

        const { items } = await service().read();

        expect(items).toEqual([]);
    });

    /**
     * The bug this test exists for, reported from a Navidrome-only station (#160).
     *
     * The shim runs in every production image, so it is reachable and unauthorized on every install
     * — and `stream` is a capability Navidrome declares too, by minting its own URLs. Reading that
     * capability told an operator whose library was fetching perfectly to go and authorize a Spotify
     * login, at `failure` severity, and routed them at a plugin page that correctly offers no such
     * card: `plugin.status.tsx` was moved onto the permission and this was not.
     */
    it('says nothing about the fetcher for a plugin that streams without using it', async () => {
        resetForwardedHop();

        const { items } = await service({
            plugins: [plugin({ id: 'deadair.navidrome', name: 'Navidrome', capabilities: ['catalog', 'stream', 'enrichment'] })],
        }).read();

        expect(items).toEqual([]);
    });

    it('names an unauthorized fetcher for the plugin that actually feeds it', async () => {
        resetForwardedHop();

        const { items } = await service({
            plugins: [
                plugin({ id: 'deadair.spotify', name: 'Spotify', capabilities: ['catalog', 'stream', 'steer', 'oauth'], usesTrackFetcher: true }),
            ],
        }).read();

        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ code: 'fetcherNotAuthorized', severity: 'failure', route: '/plugins/deadair.spotify' });
    });

    it('picks the fetcher-fed plugin out of a library that holds both kinds', async () => {
        resetForwardedHop();

        const { items } = await service({
            plugins: [
                // First in the list, and the one the capability read would have chosen.
                plugin({ id: 'deadair.navidrome', name: 'Navidrome', capabilities: ['catalog', 'stream', 'enrichment'] }),
                plugin({ id: 'deadair.spotify', name: 'Spotify', capabilities: ['catalog', 'stream', 'steer', 'oauth'], usesTrackFetcher: true }),
            ],
        }).read();

        expect(items[0]).toMatchObject({ code: 'fetcherNotAuthorized', route: '/plugins/deadair.spotify' });
    });

    it('says nothing about a fetcher that is authorized', async () => {
        resetForwardedHop();

        const { items } = await service({
            plugins: [plugin({ id: 'deadair.spotify', name: 'Spotify', capabilities: ['catalog', 'stream'], usesTrackFetcher: true })],
            authorization: { reachable: true, configured: true, authorized: true, session: true },
        }).read();

        expect(items).toEqual([]);
    });

    /**
     * A fetcher that is DOWN is a different fault with a different fix, and an authorization is
     * useless advice for it. The service reports it as nothing rather than guessing.
     */
    it('says nothing about a fetcher that did not answer', async () => {
        resetForwardedHop();

        const { items } = await service({
            plugins: [plugin({ id: 'deadair.spotify', name: 'Spotify', capabilities: ['catalog', 'stream'], usesTrackFetcher: true })],
            authorization: { reachable: false, configured: true, authorized: false, session: false },
        }).read();

        expect(items).toEqual([]);
    });
});
