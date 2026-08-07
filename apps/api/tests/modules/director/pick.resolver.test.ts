// A pick names a work; an item has to name a COPY, because that is what the
// player is handed. Everything worth testing here is a way of failing to make
// that step: a work no provider still serves, a name the catalog has never seen,
// a pick that resolves but whose metadata is missing. Each one has to cost one
// track and not a gap on the mount.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { PickResolver } from '../../../src/modules/director/pick.resolver.js';
import type { CandidatesRepository, TrackBinding } from '../../../src/modules/director/candidates.repository.js';
import type { TracksRepository } from '../../../src/modules/catalog/tracks.repository.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

interface Options {
    bindings?: Record<string, TrackBinding>;
    metadata?: Record<string, { title: string; credit: string; album?: string; year?: number; artworkUrl?: string }>;
    byName?: Record<string, string>;
}

const binding = (trackId: string, pluginId = 'deadair.spotify', durationMs?: number): TrackBinding => ({
    trackId,
    pluginId,
    externalId: `ext-${trackId}`,
    ...(durationMs === undefined ? {} : { durationMs }),
});

function build(options: Options = {}) {
    const candidates = {
        bindingsFor: vi.fn(async (trackIds: readonly string[]) => {
            const found = new Map<string, TrackBinding>();
            for (const id of trackIds) {
                const match = options.bindings?.[id];
                if (match) found.set(id, match);
            }
            return found;
        }),
        findByName: vi.fn(async (title: string, artist: string) => options.byName?.[`${artist} — ${title}`]),
    } as unknown as CandidatesRepository;

    const tracks = {
        findByIds: vi.fn(async (trackIds: readonly string[]) => {
            const found = new Map<string, NonNullable<Options['metadata']>[string]>();
            for (const id of trackIds) {
                const match = options.metadata?.[id];
                if (match) found.set(id, match);
            }
            return found;
        }),
    } as unknown as TracksRepository;

    return { resolver: new PickResolver(candidates, tracks, logger), candidates, tracks };
}

describe('PickResolver', () => {
    it('turns a pick into the copy a provider will actually serve', async () => {
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1', 'deadair.navidrome', 240_000) },
            metadata: { 'track-1': { title: 'Windowlicker', credit: 'Aphex Twin', album: 'Windowlicker', year: 1999, artworkUrl: 'art/1' } },
        });

        const resolved = await resolver.resolve([{ title: 'Windowlicker', artist: 'Aphex Twin', trackId: 'track-1' }]);

        expect(resolved).toEqual([
            {
                pluginId: 'deadair.navidrome',
                externalId: 'ext-track-1',
                title: 'Windowlicker',
                artists: ['Aphex Twin'],
                durationMs: 240_000,
                album: 'Windowlicker',
                year: 1999,
                artworkUrl: 'art/1',
                trackId: 'track-1',
            },
        ]);
    });

    it('shows the credit as written on the release, not the identity it was chosen by', async () => {
        // The pick's artist is the lead, which is what a cooldown counts. A listener
        // should see what the record says.
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'Windowlicker', credit: 'Aphex Twin feat. Someone' } },
        });

        const [resolved] = await resolver.resolve([{ title: 'Windowlicker', artist: 'Aphex Twin', trackId: 'track-1' }]);

        expect(resolved?.artists).toEqual(['Aphex Twin feat. Someone']);
    });

    it('skips a work no provider still serves, rather than airing a gap', async () => {
        // The catalog remembers it; every binding is marked missing. An item that
        // cannot resolve is silence on the mount for the length of a track.
        const { resolver } = build({ bindings: {}, metadata: {} });

        const resolved = await resolver.resolve([{ title: 'Gone', artist: 'Nobody', trackId: 'track-1' }]);

        expect(resolved).toEqual([]);
        expect(logger.warn).toHaveBeenCalled();
    });

    it('keeps the rest of the batch when one pick cannot be played', async () => {
        const { resolver } = build({
            bindings: { 'track-2': binding('track-2') },
            metadata: { 'track-2': { title: 'B', credit: 'Two' } },
        });

        const resolved = await resolver.resolve([
            { title: 'A', artist: 'One', trackId: 'track-1' },
            { title: 'B', artist: 'Two', trackId: 'track-2' },
        ]);

        expect(resolved.map(track => track.trackId)).toEqual(['track-2']);
    });

    it('matches a pick that arrived without an id, which is what a model will send', async () => {
        const { resolver, candidates } = build({
            byName: { 'Aphex Twin — Windowlicker': 'track-1' },
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'Windowlicker', credit: 'Aphex Twin' } },
        });

        const resolved = await resolver.resolve([{ title: 'Windowlicker', artist: 'Aphex Twin' }]);

        expect(resolved).toHaveLength(1);
        expect(candidates.findByName).toHaveBeenCalledWith('Windowlicker', 'Aphex Twin');
    });

    it('drops a name the catalog has never seen rather than guessing', async () => {
        // Searching the providers for it is a later rung; a near-miss here airs the
        // wrong record instead of failing visibly.
        const { resolver } = build({ byName: {} });

        expect(await resolver.resolve([{ title: 'Invented', artist: 'Hallucinated' }])).toEqual([]);
    });

    it('takes an id at its word rather than looking it up again', async () => {
        const { resolver, candidates } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
        });

        await resolver.resolve([{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(candidates.findByName).not.toHaveBeenCalled();
    });

    it('falls back to the pick when the catalog has nothing to add', async () => {
        const { resolver } = build({ bindings: { 'track-1': binding('track-1') }, metadata: {} });

        const [resolved] = await resolver.resolve([{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved).toMatchObject({ title: 'A', artists: ['One'] });
    });

    it('asks for the bindings and the metadata once for the whole batch', async () => {
        // A refill of fifteen tracks has to cost the same two queries as one.
        const { resolver, candidates, tracks } = build({
            bindings: { 'track-1': binding('track-1'), 'track-2': binding('track-2') },
            metadata: {},
        });

        await resolver.resolve([
            { title: 'A', artist: 'One', trackId: 'track-1' },
            { title: 'B', artist: 'Two', trackId: 'track-2' },
        ]);

        expect(candidates.bindingsFor).toHaveBeenCalledOnce();
        expect(tracks.findByIds).toHaveBeenCalledOnce();
    });

    it('passes the operator source preference down to the binding choice', async () => {
        const { resolver, candidates } = build({ bindings: { 'track-1': binding('track-1') }, metadata: {} });

        await resolver.resolve([{ title: 'A', artist: 'One', trackId: 'track-1' }], ['deadair.navidrome']);

        expect(candidates.bindingsFor).toHaveBeenCalledWith(['track-1'], ['deadair.navidrome']);
    });

    it('answers an empty batch without touching the database', async () => {
        const { resolver, candidates } = build();

        expect(await resolver.resolve([])).toEqual([]);
        expect(candidates.bindingsFor).not.toHaveBeenCalled();
    });
});
