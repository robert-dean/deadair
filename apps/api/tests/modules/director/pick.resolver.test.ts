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
import type { AnalysisRepository, StoredAnalysis } from '../../../src/modules/analysis/analysis.repository.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

interface Options {
    bindings?: Record<string, TrackBinding>;
    metadata?: Record<string, { title: string; credit: string; album?: string; year?: number; artworkUrl?: string }>;
    byName?: Record<string, string>;
    /**
     * The trusted `data` blob per track id. The repository has already dropped anything
     * not worth acting on, so what arrives here is a measurement the station believes.
     *
     * Typed loosely on purpose: it is jsonb a plugin wrote, and the resolver is the first
     * thing that looks inside it, so the tests below have to be able to put the wrong
     * shape in it.
     */
    analysis?: Record<string, Record<string, unknown>>;
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

    const analysis = {
        trustedAnalysisFor: vi.fn(async (ids: readonly string[]) => {
            const found = new Map<string, StoredAnalysis>();
            for (const id of ids) {
                const measured = options.analysis?.[id];
                if (measured) found.set(id, { trackId: id, schemaVersion: 1, data: measured } as StoredAnalysis);
            }
            return found;
        }),
    } as unknown as AnalysisRepository;

    return { resolver: new PickResolver(candidates, tracks, analysis, logger), candidates, tracks, analysis };
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

describe('PickResolver cue points', () => {
    it('snapshots the measured cue points onto the item', async () => {
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
            analysis: { 'track-1': { cueIn: 180, cueOut: 213_600 } },
        });

        const [resolved] = await resolver.resolve([{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved).toMatchObject({ cueInMs: 180, cueOutMs: 213_600 });
    });

    it('leaves an unmeasured track alone rather than inventing a span', async () => {
        // The ordinary state, and it has to stay ordinary: an unmeasured track plays.
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
        });

        const [resolved] = await resolver.resolve([{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved).not.toHaveProperty('cueInMs');
        expect(resolved).not.toHaveProperty('cueOutMs');
    });

    it('asks for measurements once for the whole batch', async () => {
        // Three round trips for a refill of fifteen, not three per track.
        const { resolver, analysis } = build({
            bindings: { 'track-1': binding('track-1'), 'track-2': binding('track-2') },
            metadata: { 'track-1': { title: 'A', credit: 'One' }, 'track-2': { title: 'B', credit: 'Two' } },
        });

        await resolver.resolve([
            { title: 'A', artist: 'One', trackId: 'track-1' },
            { title: 'B', artist: 'Two', trackId: 'track-2' },
        ]);

        expect(analysis.trustedAnalysisFor).toHaveBeenCalledTimes(1);
    });

    it('refuses a span that runs backwards, which would air as silence', async () => {
        // `data` is a jsonb blob a plugin wrote and the host stores unread, so this is
        // the first place anything looks inside it. A cue_out at or before cue_in makes
        // the player produce nothing at all.
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
            analysis: { 'track-1': { cueIn: 9_000, cueOut: 9_000 } },
        });

        const [resolved] = await resolver.resolve([{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved).not.toHaveProperty('cueInMs');
    });

    it('refuses values that are not finite numbers', async () => {
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
            analysis: { 'track-1': { cueIn: 0, cueOut: Number.POSITIVE_INFINITY } },
        });

        const [resolved] = await resolver.resolve([{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved).not.toHaveProperty('cueOutMs');
    });
});

describe('PickResolver loudness', () => {
    it('snapshots the measured loudness onto the item', async () => {
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
            analysis: { 'track-1': { cueIn: 0, cueOut: 1_000, integratedLufs: -19.4, truePeakDb: -0.8, samplePeakDb: -1.2 } },
        });

        const [resolved] = await resolver.resolve([{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        // `integratedLufs` on the way in, `loudnessLufs` on the item.
        expect(resolved).toMatchObject({ loudnessLufs: -19.4, truePeakDb: -0.8, samplePeakDb: -1.2 });
    });

    it('takes each field on its own, unlike the cue points', async () => {
        // An analyzer that reports a loudness and no peak is a valid analyzer, and
        // `gainFor` has a defined answer for it: cuts yes, boosts no.
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
            analysis: { 'track-1': { cueIn: 0, cueOut: 1_000, integratedLufs: -11 } },
        });

        const [resolved] = await resolver.resolve([{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved).toMatchObject({ loudnessLufs: -11 });
        expect(resolved).not.toHaveProperty('truePeakDb');
        expect(resolved).not.toHaveProperty('samplePeakDb');
    });

    it('carries loudness for a track whose cue points were rejected', async () => {
        // The two are measured together and validated apart. A backwards span says
        // nothing about how loud the record is.
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
            analysis: { 'track-1': { cueIn: 9_000, cueOut: 9_000, integratedLufs: -14, truePeakDb: -0.3 } },
        });

        const [resolved] = await resolver.resolve([{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved).not.toHaveProperty('cueInMs');
        expect(resolved).toMatchObject({ loudnessLufs: -14, truePeakDb: -0.3 });
    });

    it('leaves an unmeasured track alone', async () => {
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
        });

        const [resolved] = await resolver.resolve([{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved).not.toHaveProperty('loudnessLufs');
        expect(resolved).not.toHaveProperty('truePeakDb');
    });

    it('prefers what the file says over what the analyzer measured', async () => {
        // A -18 LUFS reference asking for -6 dB describes a record at -12, whatever
        // this station's own decode thought. The tag is what the mastering engineer
        // decided; the measurement is a guess.
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
            analysis: { 'track-1': { cueIn: 0, cueOut: 1_000, integratedLufs: -9.5, tagGainDb: -6, tagReferenceLufs: -18, truePeakDb: -0.4 } },
        });

        const [resolved] = await resolver.resolve([{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved).toMatchObject({ loudnessLufs: -12, truePeakDb: -0.4 });
    });

    it('reads an R128 tag against its own reference', async () => {
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
            analysis: { 'track-1': { cueIn: 0, cueOut: 1_000, tagGainDb: -6, tagReferenceLufs: -23 } },
        });

        const [resolved] = await resolver.resolve([{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved).toMatchObject({ loudnessLufs: -17 });
    });

    it('falls back to the measurement when the tag is half a claim', async () => {
        // A gain with no reference is not a weaker claim, it is none: the two
        // conventions in the wild are five decibels apart.
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
            analysis: { 'track-1': { cueIn: 0, cueOut: 1_000, integratedLufs: -9.5, tagGainDb: -6 } },
        });

        const [resolved] = await resolver.resolve([{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved).toMatchObject({ loudnessLufs: -9.5 });
    });

    it('never prefers the tagged peak, which is a sample peak by definition', async () => {
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
            analysis: { 'track-1': { cueIn: 0, cueOut: 1_000, integratedLufs: -14, truePeakDb: 0.6, tagPeakDb: -0.2 } },
        });

        const [resolved] = await resolver.resolve([{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved).toMatchObject({ truePeakDb: 0.6 });
        expect(resolved).not.toHaveProperty('tagPeakDb');
    });

    it('refuses anything in the blob that is not a finite number', async () => {
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
            analysis: { 'track-1': { cueIn: 0, cueOut: 1_000, integratedLufs: '-14', truePeakDb: null, samplePeakDb: Number.NaN } },
        });

        const [resolved] = await resolver.resolve([{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved).not.toHaveProperty('loudnessLufs');
        expect(resolved).not.toHaveProperty('truePeakDb');
        expect(resolved).not.toHaveProperty('samplePeakDb');
    });
});
