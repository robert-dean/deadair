// The link that makes the cache take effect. Three things matter: a hit resolves to this machine, a
// miss declines AND asks for the record so the next play is a hit, and the switch being off is the
// whole of "off" — no serve, no fill, no read at all.

import { Logger } from '@maroonedsoftware/logger';
import { JobBroker } from '@maroonedsoftware/jobbroker';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Container } from 'injectkit';
import { describe, expect, it, vi } from 'vitest';

import { TrackAudioRepository, type BindingAudio } from '../../../../src/modules/playout/audio/track.audio.repository.js';
import { TRACK_CACHE_KEY } from '../../../../src/modules/playout/audio/track.cache.settings.js';
import { DEFAULT_PLAYOUT_BASE_URL } from '../../../../src/modules/playout/playout.urls.js';
import { CachedTrackResolver } from '../../../../src/modules/playout/providers/cache.resolver.js';
import type { RundownItem } from '../../../../src/modules/playout/rundown.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const CACHED: BindingAudio = {
    id: 'row-1',
    sourceId: '11111111-2222-3333-4444-555555555555',
    checksum: 'a'.repeat(64),
    ext: 'ogg',
    byteSize: 8_947_393,
    attempts: 0,
    dueForFetch: false,
};

const MISS: BindingAudio = { id: '', sourceId: CACHED.sourceId, attempts: 0, dueForFetch: true };

const item = (overrides: Partial<RundownItem> = {}): RundownItem => ({
    id: 'rundown-1',
    pluginId: 'deadair.navidrome',
    externalId: 'track-42',
    title: 'Scourge of Iron',
    artists: ['Cannibal Corpse'],
    ...overrides,
});

const build = (options: { binding?: BindingAudio; error?: Error; settings?: Record<string, unknown> } = {}) => {
    const findByBinding = vi.fn(async () => {
        if (options.error) throw options.error;
        return options.binding;
    });
    const send = vi.fn(async () => 'job-1');
    const disposeAsync = vi.fn(async () => {});
    const container = {
        createScopedContainer: () => ({
            get: (token: unknown) => (token === TrackAudioRepository ? { findByBinding } : token === JobBroker ? { send } : undefined),
            disposeAsync,
        }),
    } as unknown as Container;
    const config = {
        get: (key: string, fallback: unknown) => (options.settings && key in options.settings ? options.settings[key] : fallback),
    } as unknown as AppConfig;

    return { resolver: new CachedTrackResolver(container, config, DEFAULT_PLAYOUT_BASE_URL, logger), findByBinding, send, disposeAsync };
};

describe('CachedTrackResolver', () => {
    it('resolves a cached record to the route that serves the station copy', async () => {
        const { resolver, send } = build({ binding: CACHED });

        expect(await resolver.resolve(item())).toBe(`http://host.docker.internal:3333/playout/audio/${CACHED.sourceId}`);
        expect(send).not.toHaveBeenCalled();
    });

    // The miss is where the cache is filled. Declining lets the provider answer next, so this play is
    // unaffected and the play after it is a hit.
    it('declines a record it does not hold, and asks for it', async () => {
        const { resolver, send } = build({ binding: MISS });

        expect(await resolver.resolve(item())).toBeUndefined();
        expect(send).toHaveBeenCalledWith('playout.cache_track', { pluginId: 'deadair.navidrome', externalId: 'track-42' });
    });

    // A binding the provider refused recently. Asking again on every boundary it comes round on is
    // exactly what the backoff exists to stop.
    it('does not ask again while a failed binding is backing off', async () => {
        const { resolver, send } = build({ binding: { ...MISS, attempts: 3, dueForFetch: false } });

        expect(await resolver.resolve(item())).toBeUndefined();
        expect(send).not.toHaveBeenCalled();
    });

    // A segment, or an item whose provider row has been deleted. There is no `track_sources` row to
    // cache against, and the links behind this one answer for both.
    it('declines an item the catalog has no binding for, without asking for it', async () => {
        const { resolver, send } = build({ binding: undefined });

        expect(await resolver.resolve(item({ pluginId: 'deadair.render', externalId: 'seg-1' }))).toBeUndefined();
        expect(send).not.toHaveBeenCalled();
    });

    it('reads nothing at all while the cache is turned off', async () => {
        const { resolver, findByBinding, send } = build({ binding: CACHED, settings: { [TRACK_CACHE_KEY]: 'false' } });

        expect(await resolver.resolve(item())).toBeUndefined();
        expect(findByBinding).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    // A resolver that threw would cost the item. The provider answers next instead.
    it('declines rather than throwing when the read fails', async () => {
        const { resolver, disposeAsync } = build({ error: new Error('the pool is gone') });

        expect(await resolver.resolve(item())).toBeUndefined();
        expect(disposeAsync).toHaveBeenCalled();
    });

    // What the measurement walk calls. A miss there means the station has never aired the record, so
    // asking for a copy would download the parts of the catalogue that never air.
    it('answers a bare binding question without asking for a copy on a miss', async () => {
        const { resolver, send } = build({ binding: MISS });

        expect(await resolver.resolveBinding('deadair.navidrome', 'track-42')).toBeUndefined();
        expect(send).not.toHaveBeenCalled();
    });

    it('serves a cached record to a bare binding question too', async () => {
        const { resolver } = build({ binding: CACHED });

        expect(await resolver.resolveBinding('deadair.navidrome', 'track-42')).toBe(
            `http://host.docker.internal:3333/playout/audio/${CACHED.sourceId}`,
        );
    });

    it('closes its scope on every path, since it opens one per hand-over', async () => {
        const { resolver, disposeAsync } = build({ binding: CACHED });

        await resolver.resolve(item());

        expect(disposeAsync).toHaveBeenCalledTimes(1);
    });
});
