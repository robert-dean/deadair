// The station's own audio, as a URL the player can fetch. Two things matter: it claims only the
// items it can speak for, so a running order holding a Spotify track and an ident resolves both;
// and it declines rather than minting a URL that would 404, because a resolver that declines makes
// `Rundown.next` skip to the following item while one that lies makes the mount go quiet.

import { Logger } from '@maroonedsoftware/logger';
import type { Container } from 'injectkit';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PLAYOUT_BASE_URL } from '../../../src/modules/playout/playout.urls.js';
import { SegmentTrackResolver } from '../../../src/modules/playout/providers/segment.resolver.js';
import type { RundownItem } from '../../../src/modules/playout/rundown.js';
import { SegmentRepository, type Segment } from '../../../src/modules/render/segment.repository.js';
import { RENDER_PLUGIN_ID } from '../../../src/modules/render/segment.source.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const READY: Segment = {
    id: 'seg-1',
    kind: 'ident',
    state: 'ready',
    label: 'Top of the hour',
    source: 'library',
    audioChecksum: 'a'.repeat(64),
    audioExt: 'mp3',
};

const item = (overrides: Partial<RundownItem> = {}): RundownItem => ({
    id: 'rundown-1',
    pluginId: RENDER_PLUGIN_ID,
    externalId: 'seg-1',
    title: 'Top of the hour',
    artists: [],
    ...overrides,
});

const build = (options: { segment?: Segment; error?: Error } = {}) => {
    const findById = vi.fn(async () => {
        if (options.error) throw options.error;
        return options.segment;
    });
    const disposeAsync = vi.fn(async () => {});
    const container = {
        createScopedContainer: () => ({ get: (token: unknown) => (token === SegmentRepository ? { findById } : undefined), disposeAsync }),
    } as unknown as Container;

    return { resolver: new SegmentTrackResolver(container, DEFAULT_PLAYOUT_BASE_URL, logger), findById, disposeAsync };
};

describe('SegmentTrackResolver', () => {
    it('resolves a ready segment to the route that serves its audio', async () => {
        const { resolver } = build({ segment: READY });

        expect(await resolver.resolve(item())).toBe('http://host.docker.internal:3333/segments/seg-1/audio');
    });

    // The chain asks each link in turn, and a link that answered for somebody else's item would
    // take a Spotify track off air.
    it('declines an item that belongs to a provider, without reading anything', async () => {
        const { resolver, findById } = build({ segment: READY });

        expect(await resolver.resolve(item({ pluginId: 'deadair.spotify', externalId: 'trk_1' }))).toBeUndefined();
        expect(findById).not.toHaveBeenCalled();
    });

    // Reachable when a segment is re-recorded or deleted between the director's commit and the
    // hand-over, which is a window of whole tracks rather than milliseconds.
    it('declines a segment that is no longer ready', async () => {
        const { resolver } = build({ segment: { ...READY, state: 'rendering', audioChecksum: undefined, audioExt: undefined } });

        expect(await resolver.resolve(item())).toBeUndefined();
        expect(logger.warn).toHaveBeenCalled();
    });

    it('declines a segment the library has lost', async () => {
        const { resolver } = build({ segment: undefined });

        expect(await resolver.resolve(item())).toBeUndefined();
    });

    // One item's worth of failure, handled the way the plugin resolver handles its own.
    it('declines rather than throwing when the read fails', async () => {
        const { resolver } = build({ error: new Error('the database is gone') });

        expect(await resolver.resolve(item())).toBeUndefined();
    });

    it('disposes its scope whichever way it answers', async () => {
        const { resolver, disposeAsync } = build({ error: new Error('the database is gone') });

        await resolver.resolve(item());

        expect(disposeAsync).toHaveBeenCalledOnce();
    });
});
