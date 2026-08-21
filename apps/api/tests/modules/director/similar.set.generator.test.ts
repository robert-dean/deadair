// The binding that reaches outside the library. Two things here are decisions rather than
// mechanics and both are asserted: it is ON by default, unlike the chart binding beside it, and it
// seeds from what RECENTLY aired rather than from what aired most — a frequency ranking would be a
// feedback loop that deepens the bubble this exists to break.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import type { ArtistTrack, SimilarArtist } from '@deadair/plugin-sdk';

import { DEFAULT_SIMILAR_MIX, SIMILAR_GENERATOR_KEYS, SimilarSetGenerator } from '../../../src/modules/director/similar.set.generator.js';
import type { SimilarityService } from '../../../src/modules/similarity/similarity.service.js';
import type { PlayHistoryRepository } from '../../../src/modules/director/play.history.repository.js';
import { DEFAULT_RULES, type ResolvedRules } from '../../../src/modules/director/rotation.rules.js';
import { songKey } from '../../../src/modules/director/rotation.keys.js';
import type { SetInputs } from '../../../src/modules/director/set.generator.js';
import { StationIdentity } from '../../../src/modules/shared/station.identity.js';

const stubLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

const rules: ResolvedRules = DEFAULT_RULES;

interface Options {
    settings?: Record<string, unknown>;
    hasSimilarity?: boolean;
    canNameTracks?: boolean;
    seeds?: string[];
    similar?: SimilarArtist[];
    tracks?: ArtistTrack[];
}

function build(options: Options = {}) {
    const settings: Record<string, unknown> = { ...options.settings };
    const config = {
        get: vi.fn((key: string, fallback?: unknown) => (key in settings ? settings[key] : fallback)),
    } as unknown as AppConfig;

    const similarTo = vi.fn(async (_ref: { name: string }, _limit: number): Promise<SimilarArtist[]> => options.similar ?? [{ name: 'Tricky' }]);
    const topTracks = vi.fn(
        async (ref: { name: string }, _limit: number): Promise<ArtistTrack[]> =>
            options.tracks ?? [{ title: 'Hell Is Round the Corner', artist: ref.name }],
    );
    const similarity = {
        hasSimilarity: () => options.hasSimilarity ?? true,
        canNameTracks: () => options.canNameTracks ?? true,
        similarTo,
        topTracks,
    } as unknown as SimilarityService;

    const recentArtists = vi.fn(async (_limit: number, _station: string) => options.seeds ?? ['Portishead']);
    const history = { recentArtists } as unknown as PlayHistoryRepository;
    const logger = stubLogger();

    return {
        generator: new SimilarSetGenerator(similarity, history, new StationIdentity(), config, logger as unknown as Logger),
        similarTo,
        topTracks,
        recentArtists,
        logger,
    };
}

const inputs = (overrides: Partial<SetInputs> = {}): SetInputs => ({ count: 10, rules, ...overrides });

beforeEach(() => {
    vi.clearAllMocks();
});

describe('the default', () => {
    it('is ON, unlike the chart binding, because reaching outward is a habit and not a format', async () => {
        // A station that only ever draws from its own library is a structural defect
        // (`station-intelligence.md` §5), not a programming choice somebody has to opt into.
        expect(DEFAULT_SIMILAR_MIX).toBeGreaterThan(0);

        const { generator, similarTo } = build();

        expect(await generator.generate(inputs())).not.toHaveLength(0);
        expect(similarTo).toHaveBeenCalled();
    });

    it('takes its declared share of the batch', async () => {
        const { generator } = build({
            settings: { [SIMILAR_GENERATOR_KEYS.mix]: 0.4 },
            similar: [{ name: 'Tricky' }, { name: 'Morcheeba' }, { name: 'Massive Attack' }, { name: 'Sneaker Pimps' }, { name: 'Lamb' }],
        });

        expect(await generator.generate(inputs({ count: 10 }))).toHaveLength(4);
    });
});

describe('when it declines', () => {
    it('says once that an installed similarity plugin is being asked for nothing', async () => {
        const { generator, logger } = build({ settings: { [SIMILAR_GENERATOR_KEYS.mix]: 0 } });

        await generator.generate(inputs());
        await generator.generate(inputs());

        expect(logger.info).toHaveBeenCalledOnce();
        expect(logger.info.mock.calls[0]![0]).toMatch(/rotation\.similarMix/);
    });

    it('stays silent about the mix when no plugin could have answered anyway', async () => {
        const { generator, logger } = build({ settings: { [SIMILAR_GENERATOR_KEYS.mix]: 0 }, hasSimilarity: false });

        await generator.generate(inputs());

        expect(logger.info).not.toHaveBeenCalled();
    });

    it('declines when a plugin can say who resembles whom but cannot name their records', async () => {
        // Both halves are required: without `artistTopTracks` there is a list of names and no way
        // to turn one into something the station can schedule.
        const { generator, similarTo } = build({ canNameTracks: false });

        expect(await generator.generate(inputs())).toEqual([]);
        expect(similarTo).not.toHaveBeenCalled();
    });

    it('declines on a station that has aired nothing yet, which fixes itself after one record', async () => {
        const { generator } = build({ seeds: [] });

        expect(await generator.generate(inputs())).toEqual([]);
    });
});

describe('seeding', () => {
    it('asks for the artists most RECENTLY aired, never the most played', async () => {
        // A frequency ranking is a positive feedback loop: what aired is what is offered, so what
        // is offered is what airs. Pointing outward from the recent past is the opposite move.
        const { generator, recentArtists } = build();

        await generator.generate(inputs());

        expect(recentArtists).toHaveBeenCalledWith(expect.any(Number), expect.any(String));
    });

    it('takes one record per neighbour, so a batch spreads across artists', async () => {
        const { generator, topTracks } = build({
            similar: [{ name: 'Tricky' }, { name: 'Morcheeba' }],
            tracks: [
                { title: 'One', artist: 'X' },
                { title: 'Two', artist: 'X' },
            ],
        });

        const picks = await generator.generate(inputs({ count: 10 }));

        expect(picks).toHaveLength(2);
        expect(topTracks).toHaveBeenCalledTimes(2);
    });

    it('skips a record the running order already holds', async () => {
        const { generator } = build({
            similar: [{ name: 'Tricky' }, { name: 'Morcheeba' }],
            tracks: [{ title: 'Overcome', artist: 'Tricky' }],
        });
        const avoidSongKeys = new Set([songKey('Overcome', ['Tricky'])]);

        expect(await generator.generate(inputs({ count: 4, avoidSongKeys }))).toEqual([]);
    });

    it('names records and never a catalog id, because it has not read the catalog', async () => {
        const { generator } = build();

        const picks = await generator.generate(inputs({ count: 3 }));

        expect(picks[0]).toEqual({ title: 'Hell Is Round the Corner', artist: 'Tricky' });
        expect(picks[0]).not.toHaveProperty('trackId');
    });

    it('keeps what it already gathered when the walk throws part way', async () => {
        // A partial answer is a good answer here: the records above cost real upstream calls, and
        // the chain tops up whatever is missing.
        const { generator } = build({ similar: [{ name: 'Tricky' }, { name: 'Morcheeba' }] });
        let call = 0;
        (generator as unknown as { similarity: { topTracks: unknown } }).similarity.topTracks = vi.fn(async (ref: { name: string }) => {
            call += 1;
            if (call > 1) throw new Error('upstream went away');
            return [{ title: 'Overcome', artist: ref.name }];
        });

        expect(await generator.generate(inputs({ count: 10 }))).toHaveLength(1);
    });

    // The PERIOD. This binding is excused `ignoresBrief` on the argument that its seeds are records
    // that actually aired, so under a brief it draws from the brief's own results. That stretches
    // much less far for a period than for a style: a neighbour of a 1975 record is stylistically
    // close and easily from 1998.
    describe('under a period', () => {
        const neighbours = [
            { title: 'In Period', artist: 'Tricky', year: 1975 },
            { title: 'Out Of Period', artist: 'Tricky', year: 1998 },
            { title: 'Undated', artist: 'Tricky' },
        ];

        it('names only what falls inside it', async () => {
            const { generator } = build({ tracks: [neighbours[1]!, neighbours[0]!] });

            const picks = await generator.generate(inputs({ count: 10, era: { from: 1970, to: 1979 } }));

            expect(picks.map(pick => pick.title)).toEqual(['In Period']);
        });

        it('keeps a neighbour the source gave no year for', async () => {
            // The same rule the draw and the resolver apply. All three have to agree, or a record is
            // eligible in one place and dropped in another.
            const { generator } = build({ tracks: [neighbours[2]!] });

            expect(await generator.generate(inputs({ count: 10, era: { from: 1970, to: 1979 } }))).toHaveLength(1);
        });

        it('comes back SHORT rather than naming a record the resolver will drop', async () => {
            // The whole argument for filtering here rather than leaving it to `PickResolver`. An
            // out-of-period pick is dropped whatever named it, so handing one over turns this
            // binding's share of the batch into nothing — where declining lets `SetGeneratorChain`
            // top up from the floor, which narrows on the same period in SQL and can fill the slot.
            const { generator } = build({ tracks: [neighbours[1]!] });

            expect(await generator.generate(inputs({ count: 10, era: { from: 1970, to: 1979 } }))).toEqual([]);
        });

        it('is unchanged by a window with no ends set', async () => {
            const { generator } = build({ tracks: [neighbours[1]!] });

            expect(await generator.generate(inputs({ count: 10, era: {} }))).toHaveLength(1);
        });
    });
});
