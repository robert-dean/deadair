// The link that hands the player a URL. What matters is that it answers the SAME url whether or not
// the station holds the bytes — the route behind it fetches them if not — and that it declines for a
// copy the catalog has written off, because that is what makes the player skip it rather than fetch
// something nothing can serve.

import { Logger } from '@maroonedsoftware/logger';
import type { Container } from 'injectkit';
import { describe, expect, it, vi } from 'vitest';

import { TrackAudioRepository } from '../../../../src/modules/playout/audio/track.audio.repository.js';
import { DEFAULT_PLAYOUT_BASE_URL } from '../../../../src/modules/playout/playout.urls.js';
import { TrackAudioResolver } from '../../../../src/modules/playout/providers/track.audio.resolver.js';
import type { RundownItem } from '../../../../src/modules/playout/rundown.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const SOURCE_ID = '11111111-2222-3333-4444-555555555555';

const item = (overrides: Partial<RundownItem> = {}): RundownItem => ({
    id: 'rundown-1',
    pluginId: 'deadair.navidrome',
    externalId: 'track-42',
    title: 'Scourge of Iron',
    artists: ['Cannibal Corpse'],
    artist: 'Cannibal Corpse',
    ...overrides,
});

const build = (options: { sourceId?: string; error?: Error } = {}) => {
    const findPlayableSourceId = vi.fn(async () => {
        if (options.error) throw options.error;
        return options.sourceId;
    });
    const disposeAsync = vi.fn(async () => {});
    const container = {
        createScopedContainer: () => ({
            get: (token: unknown) => (token === TrackAudioRepository ? { findPlayableSourceId } : undefined),
            disposeAsync,
        }),
    } as unknown as Container;

    return { resolver: new TrackAudioResolver(container, DEFAULT_PLAYOUT_BASE_URL, logger), findPlayableSourceId, disposeAsync };
};

describe('TrackAudioResolver', () => {
    // The whole point: one URL, on this machine, for every record. Nothing here knows or cares whether
    // the bytes are on disk.
    it('resolves a playable record to the station audio route', async () => {
        const { resolver } = build({ sourceId: SOURCE_ID });

        expect(await resolver.resolve(item())).toBe(`http://host.docker.internal:3333/playout/audio/${SOURCE_ID}`);
    });

    it('asks only whether the catalog still offers the copy', async () => {
        const { resolver, findPlayableSourceId } = build({ sourceId: SOURCE_ID });

        await resolver.resolve(item());

        expect(findPlayableSourceId).toHaveBeenCalledWith('deadair.navidrome', 'track-42');
    });

    // A copy carrying `missing_at`, or one the provider marked unplayable. Declining is what makes
    // `Rundown.next` move on rather than handing over a URL nothing can serve.
    it('declines a copy the catalog has written off', async () => {
        const { resolver } = build({ sourceId: undefined });

        expect(await resolver.resolve(item())).toBeUndefined();
    });

    // A segment's `externalId` is a segment id, so it matches no binding and falls to the next link.
    it('declines an item that is not a catalog binding at all', async () => {
        const { resolver } = build({ sourceId: undefined });

        expect(await resolver.resolve(item({ pluginId: 'deadair.render', externalId: 'seg-1' }))).toBeUndefined();
    });

    // What the measurement walk calls. It gets the same self-sufficient URL the player gets.
    it('answers a bare binding question with the same url', async () => {
        const { resolver } = build({ sourceId: SOURCE_ID });

        expect(await resolver.resolveBinding('deadair.navidrome', 'track-42')).toBe(`http://host.docker.internal:3333/playout/audio/${SOURCE_ID}`);
    });

    it('declines rather than throwing when the read fails', async () => {
        const { resolver, disposeAsync } = build({ error: new Error('the pool is gone') });

        expect(await resolver.resolve(item())).toBeUndefined();
        expect(disposeAsync).toHaveBeenCalled();
    });

    it('closes its scope on every path, since it opens one per hand-over', async () => {
        const { resolver, disposeAsync } = build({ sourceId: SOURCE_ID });

        await resolver.resolve(item());

        expect(disposeAsync).toHaveBeenCalledTimes(1);
    });
});
