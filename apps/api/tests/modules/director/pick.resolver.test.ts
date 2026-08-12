// A pick names a work; an item has to name a COPY, because that is what the
// player is handed. Everything worth testing here is a way of failing to make
// that step: a work no provider still serves, a name the catalog has never seen,
// a pick that resolves but whose metadata is missing. Each one has to cost one
// track and not a gap on the mount.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';

import { DISCOVER_KEY, MAX_DISCOVERIES, PickResolver } from '../../../src/modules/director/pick.resolver.js';
import type { ProviderTrackLookup } from '../../../src/modules/director/provider.track.lookup.js';
import type { CatalogResolverService } from '../../../src/modules/catalog/ingest/catalog.resolver.service.js';
import type { CandidatesRepository, TrackBinding } from '../../../src/modules/director/candidates.repository.js';
import type { PlayHistoryRepository } from '../../../src/modules/director/play.history.repository.js';
import { DEFAULT_RULES, type ResolvedRules } from '../../../src/modules/director/rotation.rules.js';
import type { TrackPick } from '../../../src/modules/director/set.generator.js';
import type { TracksRepository } from '../../../src/modules/catalog/tracks.repository.js';
import type { AnalysisRepository, StoredAnalysis } from '../../../src/modules/analysis/analysis.repository.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

/**
 * Rules that suppress nothing, which is what every test about RESOLUTION wants.
 *
 * The resolver now judges as well as resolves, so a test asking "does this pick become a copy" has
 * to say it is not also asking "may this pick air". The rule tests below pass their own.
 */
const OPEN_RULES: ResolvedRules = { ...DEFAULT_RULES, repeatWindowDays: 0, artistCooldownMinutes: 0, maxPerArtist: 0 };

/** `resolve` with the rules filled in, so the resolution tests read as they did before it took them. */
const resolve = (resolver: PickResolver, picks: readonly TrackPick[], preference?: readonly string[]) =>
    resolver.resolve(picks, OPEN_RULES, preference);

interface Options {
    bindings?: Record<string, TrackBinding>;
    metadata?: Record<string, { title: string; credit: string; album?: string; year?: number; artworkUrl?: string }>;
    byName?: Record<string, string>;
    /** What the station thinks of each track: -1 disliked, 0 unrated, 1 liked. Absent means unrated. */
    ratings?: Record<string, number>;
    /** Song keys inside the repeat window, as `play_history` would answer them. */
    recentSongs?: string[];
    /** Artist keys inside the cooldown. */
    recentArtists?: string[];
    /**
     * The trusted `data` blob per track id. The repository has already dropped anything
     * not worth acting on, so what arrives here is a measurement the station believes.
     *
     * Typed loosely on purpose: it is jsonb a plugin wrote, and the resolver is the first
     * thing that looks inside it, so the tests below have to be able to put the wrong
     * shape in it.
     */
    analysis?: Record<string, Record<string, unknown>>;
    /** What a provider has, keyed the way `byName` is: `Artist — Title`. */
    atProvider?: Record<string, { pluginId: string; track: { id: string; title: string; artists: string[] } }>;
    /** Whether `rotation.discover` is on. On is the default, as it is in the registry. */
    discover?: boolean;
    /** Whether any plugin can be searched at all. */
    canLookUp?: boolean;
    /** An ingest that refuses the item, as one with no credited artist does. */
    ingestSkips?: boolean;
    /** The canonical id an ingest answers with. */
    ingestsAs?: string;
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
        ratingsFor: vi.fn(async (trackIds: readonly string[]) => {
            const found = new Map<string, number>();
            for (const id of trackIds) {
                const rating = options.ratings?.[id];
                if (rating !== undefined) found.set(id, rating);
            }
            return found;
        }),
    } as unknown as CandidatesRepository;

    const history = {
        songKeysSince: vi.fn(async (days: number) => new Set(days > 0 ? (options.recentSongs ?? []) : [])),
        artistKeysSince: vi.fn(async (minutes: number) => new Set(minutes > 0 ? (options.recentArtists ?? []) : [])),
    } as unknown as PlayHistoryRepository;

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

    // The rung under the catalog: a provider that has the record under that exact name, and the
    // ingest that turns it into a row. Both silent by default -- no provider carries anything --
    // so every test above this one behaves as it did before the rung existed.
    const find = vi.fn(async (title: string, artist: string) => options.atProvider?.[`${artist} — ${title}`]);
    const lookup = {
        canLookUp: () => options.canLookUp ?? true,
        find,
    } as unknown as ProviderTrackLookup;

    const ingestTrack = vi.fn(async (pluginId: string, track: { id: string }, origin: string) => {
        if (options.ingestSkips) return { status: 'skipped' as const, reason: 'no-artist' as const };
        ingested.push({ pluginId, externalId: track.id, origin });
        return { status: 'ingested' as const, trackId: options.ingestsAs ?? `cat-${track.id}`, created: true };
    });
    const ingested: { pluginId: string; externalId: string; origin: string }[] = [];
    const ingest = { ingestTrack } as unknown as CatalogResolverService;

    const values: Record<string, boolean> = { [DISCOVER_KEY]: options.discover ?? true };
    const config = { get: (key: string, fallback: unknown) => values[key] ?? fallback } as unknown as AppConfig;

    return {
        resolver: new PickResolver(candidates, tracks, analysis, history, lookup, ingest, config, logger),
        candidates,
        tracks,
        analysis,
        history,
        find,
        ingestTrack,
        ingested: () => ingested,
    };
}

describe('PickResolver', () => {
    it('turns a pick into the copy a provider will actually serve', async () => {
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1', 'deadair.navidrome', 240_000) },
            metadata: { 'track-1': { title: 'Windowlicker', credit: 'Aphex Twin', album: 'Windowlicker', year: 1999, artworkUrl: 'art/1' } },
        });

        const resolved = await resolve(resolver, [{ title: 'Windowlicker', artist: 'Aphex Twin', trackId: 'track-1' }]);

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

        const [resolved] = await resolve(resolver, [{ title: 'Windowlicker', artist: 'Aphex Twin', trackId: 'track-1' }]);

        expect(resolved?.artists).toEqual(['Aphex Twin feat. Someone']);
    });

    it('skips a work no provider still serves, rather than airing a gap', async () => {
        // The catalog remembers it; every binding is marked missing. An item that
        // cannot resolve is silence on the mount for the length of a track.
        const { resolver } = build({ bindings: {}, metadata: {} });

        const resolved = await resolve(resolver, [{ title: 'Gone', artist: 'Nobody', trackId: 'track-1' }]);

        expect(resolved).toEqual([]);
        expect(logger.warn).toHaveBeenCalled();
    });

    it('keeps the rest of the batch when one pick cannot be played', async () => {
        const { resolver } = build({
            bindings: { 'track-2': binding('track-2') },
            metadata: { 'track-2': { title: 'B', credit: 'Two' } },
        });

        const resolved = await resolve(resolver, [
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

        const resolved = await resolve(resolver, [{ title: 'Windowlicker', artist: 'Aphex Twin' }]);

        expect(resolved).toHaveLength(1);
        expect(candidates.findByName).toHaveBeenCalledWith('Windowlicker', 'Aphex Twin');
    });

    it('drops a name neither the catalog nor any provider has, rather than guessing', async () => {
        // A near-miss airs the wrong record instead of failing visibly, so nothing here is
        // approximate: the lookup refuses anything that is not an exact normalized match.
        const { resolver } = build({ byName: {}, atProvider: {} });

        expect(await resolve(resolver, [{ title: 'Invented', artist: 'Hallucinated' }])).toEqual([]);
    });

    it('takes an id at its word rather than looking it up again', async () => {
        const { resolver, candidates } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
        });

        await resolve(resolver, [{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(candidates.findByName).not.toHaveBeenCalled();
    });

    it('falls back to the pick when the catalog has nothing to add', async () => {
        const { resolver } = build({ bindings: { 'track-1': binding('track-1') }, metadata: {} });

        const [resolved] = await resolve(resolver, [{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved).toMatchObject({ title: 'A', artists: ['One'] });
    });

    it('asks for the bindings and the metadata once for the whole batch', async () => {
        // A refill of fifteen tracks has to cost the same two queries as one.
        const { resolver, candidates, tracks } = build({
            bindings: { 'track-1': binding('track-1'), 'track-2': binding('track-2') },
            metadata: {},
        });

        await resolve(resolver, [
            { title: 'A', artist: 'One', trackId: 'track-1' },
            { title: 'B', artist: 'Two', trackId: 'track-2' },
        ]);

        expect(candidates.bindingsFor).toHaveBeenCalledOnce();
        expect(tracks.findByIds).toHaveBeenCalledOnce();
    });

    it('passes the operator source preference down to the binding choice', async () => {
        const { resolver, candidates } = build({ bindings: { 'track-1': binding('track-1') }, metadata: {} });

        await resolve(resolver, [{ title: 'A', artist: 'One', trackId: 'track-1' }], ['deadair.navidrome']);

        expect(candidates.bindingsFor).toHaveBeenCalledWith(['track-1'], ['deadair.navidrome']);
    });

    it('answers an empty batch without touching the database', async () => {
        const { resolver, candidates } = build();

        expect(await resolve(resolver, [])).toEqual([]);
        expect(candidates.bindingsFor).not.toHaveBeenCalled();
    });
});

// The rung that makes "the provider's whole catalog" mean anything: the library is filled by
// walking playlists, so a perfectly good pick outside them matched nothing and was dropped. What is
// worth testing is that the record becomes a real catalog row (the player fetches through
// `track_sources`, so nothing else can air), that it is marked so the sync's sweep cannot bench it,
// and that every way this can fail costs one track rather than the batch.
describe('PickResolver discovering a record at a provider', () => {
    const missing = {
        byName: {},
        atProvider: {
            'Sleep — Dopesmoker': { pluginId: 'deadair.spotify', track: { id: 'sp_1', title: 'Dopesmoker', artists: ['Sleep'] } },
        },
        bindings: { 'cat-sp_1': binding('cat-sp_1') },
        metadata: { 'cat-sp_1': { title: 'Dopesmoker', credit: 'Sleep' } },
    };

    const pick = [{ title: 'Dopesmoker', artist: 'Sleep' }];

    it('takes a record the catalog has never seen into the catalog and airs it', async () => {
        const { resolver } = build(missing);

        const resolved = await resolve(resolver, pick);

        expect(resolved).toHaveLength(1);
        expect(resolved[0]).toMatchObject({ trackId: 'cat-sp_1', pluginId: 'deadair.spotify' });
    });

    it('marks the copy as discovered, so the sync sweep cannot bench it', async () => {
        // It is in no playlist and a walk will never see it, so the sweep would mark it missing
        // within the hour of the station finding it.
        const { resolver, ingested } = build(missing);

        await resolve(resolver, pick);

        expect(ingested()).toEqual([{ pluginId: 'deadair.spotify', externalId: 'sp_1', origin: 'discovered' }]);
    });

    it('does not look anything up while the operator has that turned off', async () => {
        const { resolver, find } = build({ ...missing, discover: false });

        expect(await resolve(resolver, pick)).toEqual([]);
        expect(find).not.toHaveBeenCalled();
    });

    it('does not look anything up when no provider can be searched', async () => {
        const { resolver, find } = build({ ...missing, canLookUp: false });

        await resolve(resolver, pick);

        expect(find).not.toHaveBeenCalled();
    });

    it('never looks up a pick the catalog already holds', async () => {
        const { resolver, find } = build({
            byName: { 'Sleep — Dopesmoker': 'track-1' },
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'Dopesmoker', credit: 'Sleep' } },
        });

        await resolve(resolver, pick);

        expect(find).not.toHaveBeenCalled();
    });

    it('bounds how many records one refill may look up', async () => {
        // Every miss is a search across every provider. An unlucky batch would otherwise spend a
        // provider's whole rate budget on one refill.
        const { resolver, find } = build({ byName: {}, atProvider: {} });

        await resolve(
            resolver,
            Array.from({ length: MAX_DISCOVERIES + 5 }, (_, index) => ({ title: `T${index}`, artist: `A${index}` })),
        );

        expect(find).toHaveBeenCalledTimes(MAX_DISCOVERIES);
    });

    it('drops one track rather than the batch when the lookup throws', async () => {
        const { resolver, find } = build({
            byName: {},
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
        });
        find.mockRejectedValueOnce(new Error('the provider is down'));

        const resolved = await resolve(resolver, [{ title: 'Dopesmoker', artist: 'Sleep' }, { title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved.map(track => track.trackId)).toEqual(['track-1']);
    });

    it('drops the pick when the record cannot become a catalog row', async () => {
        // An item the provider credits to nobody. `tracks.artist_id` is NOT NULL, so there is no
        // row to attach it to and the ingest refuses it rather than inventing an artist.
        const { resolver } = build({ ...missing, ingestSkips: true });

        expect(await resolve(resolver, pick)).toEqual([]);
    });

    it('judges a newly ingested record against what the operator already thinks of its artist', async () => {
        // The ordering that makes this safe: ingest, then judge. A record by a disliked act is
        // dropped at the lookup's expense rather than aired because nothing had an opinion yet.
        const { resolver } = build({ ...missing, ratings: { 'cat-sp_1': -1 } });

        expect(await resolve(resolver, pick)).toEqual([]);
    });
});

// The rules used to live inside `CatalogSetGenerator`, which was correct exactly as long as it was
// the only generator. A pick is a NAME, so a second binding hands over titles nothing has judged.
// These are about the guarantee that judging happens HERE instead, whatever named the track.
describe('PickResolver rules', () => {
    const rules = (overrides: Partial<ResolvedRules> = {}): ResolvedRules => ({ ...OPEN_RULES, ...overrides });

    const twoTracks = {
        bindings: { 'track-1': binding('track-1'), 'track-2': binding('track-2') },
        metadata: { 'track-1': { title: 'A', credit: 'One' }, 'track-2': { title: 'B', credit: 'Two' } },
    };

    it('refuses a disliked track even when every other rule is off', async () => {
        // The case the whole phase exists for. A `setlist` resolves to NO_RULES, so nothing else
        // here suppresses anything -- and a dislike still has to hold, because it is an
        // instruction about what the station may play rather than a preference about how often.
        const { resolver } = build({ ...twoTracks, ratings: { 'track-1': -1 } });

        const resolved = await resolver.resolve(
            [
                { title: 'A', artist: 'One', trackId: 'track-1' },
                { title: 'B', artist: 'Two', trackId: 'track-2' },
            ],
            rules(),
        );

        expect(resolved.map(track => track.trackId)).toEqual(['track-2']);
    });

    it('refuses a disliked track a generator named without an id', async () => {
        // The actual attack surface: a model returns a title and an artist, so nothing upstream
        // of here has ever seen the rating.
        const { resolver } = build({
            byName: { 'One — A': 'track-1' },
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
            ratings: { 'track-1': -1 },
        });

        expect(await resolver.resolve([{ title: 'A', artist: 'One' }], rules())).toEqual([]);
    });

    it('keeps a track the catalog has no rating row for', async () => {
        // `identify` already established the track exists, so a missing rating is a join that
        // found no album -- not a record nobody has an opinion about.
        const { resolver } = build({ ...twoTracks, ratings: {} });

        const resolved = await resolver.resolve([{ title: 'A', artist: 'One', trackId: 'track-1' }], rules());

        expect(resolved).toHaveLength(1);
    });

    it('drops a track inside the repeat window', async () => {
        const { resolver } = build({ ...twoTracks, recentSongs: ['one:a'] });

        const resolved = await resolver.resolve(
            [
                { title: 'A', artist: 'One', trackId: 'track-1' },
                { title: 'B', artist: 'Two', trackId: 'track-2' },
            ],
            rules({ repeatWindowDays: 3 }),
        );

        expect(resolved.map(track => track.trackId)).toEqual(['track-2']);
    });

    it('drops an artist inside the cooldown', async () => {
        const { resolver } = build({ ...twoTracks, recentArtists: ['one'] });

        const resolved = await resolver.resolve(
            [
                { title: 'A', artist: 'One', trackId: 'track-1' },
                { title: 'B', artist: 'Two', trackId: 'track-2' },
            ],
            rules({ artistCooldownMinutes: 40 }),
        );

        expect(resolved.map(track => track.trackId)).toEqual(['track-2']);
    });

    it('reads neither window when its rule is off, which is what makes a disabled rule free', async () => {
        const { resolver, history } = build(twoTracks);

        await resolver.resolve([{ title: 'A', artist: 'One', trackId: 'track-1' }], rules());

        expect(history.songKeysSince).toHaveBeenCalledWith(0);
        expect(history.artistKeysSince).toHaveBeenCalledWith(0);
    });

    it('caps how many of one artist a batch may carry', async () => {
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1'), 'track-2': binding('track-2'), 'track-3': binding('track-3') },
            metadata: {},
        });

        const resolved = await resolver.resolve(
            [
                { title: 'A', artist: 'One', trackId: 'track-1' },
                { title: 'B', artist: 'One', trackId: 'track-2' },
                { title: 'C', artist: 'One', trackId: 'track-3' },
            ],
            rules({ maxPerArtist: 2 }),
        );

        expect(resolved).toHaveLength(2);
    });

    it('spaces one artist off its own heels', async () => {
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1'), 'track-2': binding('track-2'), 'track-3': binding('track-3') },
            metadata: {},
        });

        const resolved = await resolver.resolve(
            [
                { title: 'A', artist: 'One', trackId: 'track-1' },
                { title: 'B', artist: 'One', trackId: 'track-2' },
                { title: 'C', artist: 'Two', trackId: 'track-3' },
            ],
            rules(),
        );

        expect(resolved.map(track => track.artists[0])).toEqual(['One', 'Two', 'One']);
    });

    it('spaces AFTER the unplayable ones are dropped, not before', async () => {
        // The ordering trap. Spacing first gives [One, Two, One]; then track-2 turns out to have
        // no binding and the gap closes back up, leaving the two One records adjacent -- which is
        // the exact thing spacing exists to prevent.
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1'), 'track-3': binding('track-3'), 'track-4': binding('track-4') },
            metadata: {},
        });

        const resolved = await resolver.resolve(
            [
                { title: 'A', artist: 'One', trackId: 'track-1' },
                { title: 'B', artist: 'Two', trackId: 'track-2' },
                { title: 'C', artist: 'One', trackId: 'track-3' },
                { title: 'D', artist: 'Three', trackId: 'track-4' },
            ],
            rules(),
        );

        expect(resolved.map(track => track.artists[0])).toEqual(['One', 'Three', 'One']);
    });

    it('leaves no rotation bookkeeping on the item it hands over', async () => {
        // The keys are a rotation concern; a rundown item has no business carrying them.
        const { resolver } = build({ bindings: { 'track-1': binding('track-1') }, metadata: {} });

        const [resolved] = await resolver.resolve([{ title: 'A', artist: 'One', trackId: 'track-1' }], rules());

        expect(resolved).not.toHaveProperty('songKey');
        expect(resolved).not.toHaveProperty('artistKey');
        expect(resolved).not.toHaveProperty('rating');
    });
});

describe('PickResolver cue points', () => {
    it('snapshots all four measured cue points onto the item', async () => {
        // Four rather than two: the outer pair trims the record and the inner pair is
        // what a blend between two records is sized from. See `crossfade.ts`.
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
            analysis: { 'track-1': { cueIn: 180, introEnd: 12_400, outroStart: 198_000, cueOut: 213_600 } },
        });

        const [resolved] = await resolve(resolver, [{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved).toMatchObject({ cueInMs: 180, introEndMs: 12_400, outroStartMs: 198_000, cueOutMs: 213_600 });
    });

    it('leaves an unmeasured track alone rather than inventing a span', async () => {
        // The ordinary state, and it has to stay ordinary: an unmeasured track plays.
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
        });

        const [resolved] = await resolve(resolver, [{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved).not.toHaveProperty('cueInMs');
        expect(resolved).not.toHaveProperty('cueOutMs');
    });

    it('takes all four or none, so a half-measured blob does not trim', async () => {
        // Stricter than the trim needs, deliberately. The four points describe one
        // shape, and a measurement that cannot say where the record is underway is not
        // one to trust about where it stops either.
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
            analysis: { 'track-1': { cueIn: 180, cueOut: 213_600 } },
        });

        const [resolved] = await resolve(resolver, [{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved).not.toHaveProperty('cueInMs');
        expect(resolved).not.toHaveProperty('cueOutMs');
    });

    it('refuses points that are out of order among themselves', async () => {
        // `measure.py` clamps its output into this order before it answers, so a blob
        // arriving out of order is not an imprecise detector: it came from something else.
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
            analysis: { 'track-1': { cueIn: 180, introEnd: 198_000, outroStart: 12_400, cueOut: 213_600 } },
        });

        const [resolved] = await resolve(resolver, [{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved).not.toHaveProperty('introEndMs');
    });

    it('accepts a record with no intro and no outro to speak of', async () => {
        // The inner comparisons are non-strict on purpose. A record that is underway
        // from its first sample, or one that ends the instant its outro begins, is a
        // real record rather than a bad blob — it simply gets no blend.
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
            analysis: { 'track-1': { cueIn: 0, introEnd: 0, outroStart: 180_000, cueOut: 180_000 } },
        });

        const [resolved] = await resolve(resolver, [{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved).toMatchObject({ cueInMs: 0, introEndMs: 0, outroStartMs: 180_000, cueOutMs: 180_000 });
    });

    it('asks for measurements once for the whole batch', async () => {
        // Three round trips for a refill of fifteen, not three per track.
        const { resolver, analysis } = build({
            bindings: { 'track-1': binding('track-1'), 'track-2': binding('track-2') },
            metadata: { 'track-1': { title: 'A', credit: 'One' }, 'track-2': { title: 'B', credit: 'Two' } },
        });

        await resolve(resolver, [
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
            analysis: { 'track-1': { cueIn: 9_000, introEnd: 9_000, outroStart: 9_000, cueOut: 9_000 } },
        });

        const [resolved] = await resolve(resolver, [{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved).not.toHaveProperty('cueInMs');
    });

    it('refuses values that are not finite numbers', async () => {
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
            analysis: { 'track-1': { cueIn: 0, introEnd: 5_000, outroStart: 60_000, cueOut: Number.POSITIVE_INFINITY } },
        });

        const [resolved] = await resolve(resolver, [{ title: 'A', artist: 'One', trackId: 'track-1' }]);

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

        const [resolved] = await resolve(resolver, [{ title: 'A', artist: 'One', trackId: 'track-1' }]);

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

        const [resolved] = await resolve(resolver, [{ title: 'A', artist: 'One', trackId: 'track-1' }]);

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

        const [resolved] = await resolve(resolver, [{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved).not.toHaveProperty('cueInMs');
        expect(resolved).toMatchObject({ loudnessLufs: -14, truePeakDb: -0.3 });
    });

    it('leaves an unmeasured track alone', async () => {
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
        });

        const [resolved] = await resolve(resolver, [{ title: 'A', artist: 'One', trackId: 'track-1' }]);

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

        const [resolved] = await resolve(resolver, [{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved).toMatchObject({ loudnessLufs: -12, truePeakDb: -0.4 });
    });

    it('reads an R128 tag against its own reference', async () => {
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
            analysis: { 'track-1': { cueIn: 0, cueOut: 1_000, tagGainDb: -6, tagReferenceLufs: -23 } },
        });

        const [resolved] = await resolve(resolver, [{ title: 'A', artist: 'One', trackId: 'track-1' }]);

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

        const [resolved] = await resolve(resolver, [{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved).toMatchObject({ loudnessLufs: -9.5 });
    });

    it('never prefers the tagged peak, which is a sample peak by definition', async () => {
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
            analysis: { 'track-1': { cueIn: 0, cueOut: 1_000, integratedLufs: -14, truePeakDb: 0.6, tagPeakDb: -0.2 } },
        });

        const [resolved] = await resolve(resolver, [{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved).toMatchObject({ truePeakDb: 0.6 });
        expect(resolved).not.toHaveProperty('tagPeakDb');
    });

    it('refuses anything in the blob that is not a finite number', async () => {
        const { resolver } = build({
            bindings: { 'track-1': binding('track-1') },
            metadata: { 'track-1': { title: 'A', credit: 'One' } },
            analysis: { 'track-1': { cueIn: 0, cueOut: 1_000, integratedLufs: '-14', truePeakDb: null, samplePeakDb: Number.NaN } },
        });

        const [resolved] = await resolve(resolver, [{ title: 'A', artist: 'One', trackId: 'track-1' }]);

        expect(resolved).not.toHaveProperty('loudnessLufs');
        expect(resolved).not.toHaveProperty('truePeakDb');
        expect(resolved).not.toHaveProperty('samplePeakDb');
    });
});
