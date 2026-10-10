// The generator is where the rules actually meet the library, so what matters
// here is that it applies them at all — a station whose repeat window is
// computed and then ignored sounds exactly like one with no window — and that a
// library too small to satisfy them comes back short rather than empty-handed or
// repeating itself.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import { DateTime } from 'luxon';

import type { AdvisoryWatch } from '../../../src/modules/director/advisory.watch.js';
import type { EraWatch } from '../../../src/modules/director/era.watch.js';
import { ADVISORY_KEY } from '../../../src/modules/director/advisory.policy.js';
import { CatalogSetGenerator } from '../../../src/modules/director/catalog.set.generator.js';
import type { CandidatesRepository, CandidateTrack } from '../../../src/modules/director/candidates.repository.js';
import { PLAY_HISTORY_RETENTION_DAYS, type PlayHistoryRepository } from '../../../src/modules/director/play.history.repository.js';
import { artistKey, songKey } from '../../../src/modules/director/rotation.keys.js';
import { DEFAULT_RULES, resolveRules } from '../../../src/modules/director/rotation.rules.js';
import { DEFAULT_SMART_SHUFFLE_DAYS, SMART_SHUFFLE_KEYS } from '../../../src/modules/director/smart.shuffle.js';
import { ARTIST_RETURN_DAYS_RANGE, DEFAULT_ARTIST_RETURN_DAYS, REDISCOVER_KEYS } from '../../../src/modules/director/rediscover.js';
import { StationIdentity } from '../../../src/modules/shared/station.identity.js';
import type { BlockRulesRepository } from '../../../src/modules/director/block.rules.repository.js';
import type { LyricLabelsRepository } from '../../../src/modules/lyrics/lyric.labels.repository.js';
import type { MoodDistribution } from '../../../src/modules/lyrics/lyric.moods.js';
import { MOOD_BOOST } from '../../../src/modules/director/mood.lean.js';
import { NeverPlay } from '../../../src/modules/director/never.play.js';
import type { BlockRule } from '../../../src/modules/director/block.rules.js';
import { sampleSize, type SampleExclusions } from '../../../src/modules/director/candidates.repository.js';

const candidate = (title: string, artist: string, rating = 0): CandidateTrack => ({
    trackId: `id-${artist}-${title}`,
    title,
    artist,
    credit: artist,
    rating,
});

interface Options {
    sample?: CandidateTrack[];
    songKeys?: Set<string>;
    artistKeys?: Set<string>;
    /** Albums the operator likes, as `albumsWithLikes` answers. */
    likedAlbums?: Set<string>;
    likedAlbumsFail?: boolean;
    /** Artists aired inside the artist-return window, which is a week or more and so never the cooldown. */
    airedArtists?: Set<string>;
    /** When each song last aired, as history answers it inside the smart shuffle's horizon. */
    lastAired?: Map<string, DateTime>;
    settings?: Record<string, unknown>;
    /** A genre steer in force, and the extra sample its loose draw finds. */
    steer?: { genres: string[]; leaning: CandidateTrack[] };
    /** Each track's genres, as `tagsFor` answers them. */
    tags?: Record<string, string[]>;
    /** What mood a model judged each record to be in, keyed by track id. */
    moods?: Map<string, MoodDistribution>;
    /** The judged moods cannot be read at all. */
    moodsFail?: boolean;
    /** The station's never-play rules, as the repository lists them. */
    neverPlay?: BlockRule[];
    /** The rules cannot be read at all. */
    neverPlayFails?: boolean;
    /**
     * A whole library for `sample` to draw from the way the SQL does: in this order, without what a
     * previous draw returned or what is tagged exactly a refused value, and no more than a sample's
     * size. Replaces {@link Options.sample} when set.
     */
    library?: CandidateTrack[];
}

/** What `sample`'s SQL leaves out of a library for one draw, said again in memory. */
function drawFrom(library: readonly CandidateTrack[], tags: Record<string, string[]>, count: number, exclude?: SampleExclusions): CandidateTrack[] {
    const drawn = new Set(exclude?.trackIds ?? []);
    const refused = new Set((exclude?.refusedTags ?? []).map(tag => tag.trim().toLowerCase()));
    return library
        .filter(track => !drawn.has(track.trackId))
        .filter(track => !(tags[track.trackId] ?? []).some(tag => refused.has(tag.trim().toLowerCase())))
        .slice(0, sampleSize(count));
}

function build(options: Options = {}) {
    const candidates = {
        sample: vi.fn(async (...args: unknown[]) => {
            if (args[4] !== undefined) return options.steer?.leaning ?? [];
            if (options.library === undefined) return options.sample ?? [];
            return drawFrom(options.library, options.tags ?? {}, args[0] as number, args[5] as SampleExclusions | undefined);
        }),
        albumsWithLikes: vi.fn(async (ids: readonly string[]) => {
            if (options.likedAlbumsFail) throw new Error('the albums table is gone');
            return new Set(ids.filter(id => options.likedAlbums?.has(id)));
        }),
        tagsFor: vi.fn(async (ids: readonly string[]) => new Map(ids.flatMap(id => (options.tags?.[id] ? [[id, options.tags[id]!]] : [])))),
    } as unknown as CandidatesRepository;
    const rules = {
        steer: vi.fn(async () => (options.steer === undefined ? undefined : { genres: options.steer.genres, endsAt: '2099-01-01T00:00:00.000Z' })),
        list: vi.fn(async () => {
            if (options.neverPlayFails) throw new Error('the rules table is gone');
            return options.neverPlay ?? [];
        }),
    } as unknown as BlockRulesRepository;

    const history = {
        songKeysSince: vi.fn(async (days: number) => (days > 0 ? (options.songKeys ?? new Set()) : new Set())),
        artistKeysSince: vi.fn(async (minutes: number) => {
            if (minutes <= 0) return new Set();
            return minutes >= ARTIST_RETURN_DAYS_RANGE.min * 24 * 60 ? (options.airedArtists ?? new Set()) : (options.artistKeys ?? new Set());
        }),
        lastAiredSince: vi.fn(async (days: number) => (days > 0 ? (options.lastAired ?? new Map()) : new Map())),
    } as unknown as PlayHistoryRepository;

    const settings: Record<string, unknown> = { ...options.settings };
    const config = {
        get: vi.fn((key: string, fallback?: unknown) => (key in settings ? settings[key] : fallback)),
    } as unknown as AppConfig;

    const watch = { starved: vi.fn(), clear: vi.fn() } as unknown as AdvisoryWatch;
    const eraWatch = { starved: vi.fn(), clear: vi.fn() } as unknown as EraWatch;
    const labels = {
        moodsForTracks: vi.fn(async () => {
            if (options.moodsFail) throw new Error('the labels table is gone');
            return options.moods ?? new Map();
        }),
    } as unknown as LyricLabelsRepository;

    return {
        generator: new CatalogSetGenerator(
            candidates,
            rules,
            history,
            new StationIdentity(),
            config,
            watch,
            eraWatch,
            labels,
            new NeverPlay(rules, candidates, config),
        ),
        labels,
        candidates,
        history,
        watch,
        eraWatch,
    };
}

const rotation = resolveRules('rotation');

describe('CatalogSetGenerator', () => {
    it('names tracks with the ids it already knows, so resolution is exact', async () => {
        const { generator } = build({ sample: [candidate('A', 'One')] });

        expect(await generator.generate({ count: 1, rules: rotation })).toEqual([{ title: 'A', artist: 'One', trackId: 'id-One-A' }]);
    });

    it('drops what is inside the repeat window', async () => {
        const { generator } = build({
            sample: [candidate('A', 'One'), candidate('B', 'Two')],
            songKeys: new Set([songKey('A', ['One'])]),
        });

        const picks = await generator.generate({ count: 2, rules: rotation });

        expect(picks.map(pick => pick.title)).toEqual(['B']);
    });

    it('drops everything by an artist inside the cooldown', async () => {
        const { generator } = build({
            sample: [candidate('A', 'One'), candidate('B', 'One')],
            artistKeys: new Set([artistKey(['One'])]),
        });

        expect(await generator.generate({ count: 2, rules: rotation })).toEqual([]);
    });

    it('never asks for a window the lineup has turned off', async () => {
        // A disabled rule has to cost no query, which is what lets a setlist run
        // with no rotation machinery at all rather than a branch at every call site.
        const { generator, history } = build({ sample: [candidate('A', 'One')] });

        await generator.generate({ count: 1, rules: resolveRules('setlist') });

        expect(history.songKeysSince).toHaveBeenCalledWith(0, 'main');
        expect(history.artistKeysSince).toHaveBeenCalledWith(0, 'main');
    });

    it('honours what the caller says the lineup already holds', async () => {
        // History knows what AIRED. A track queued ten minutes ago and not yet played
        // is invisible to it, and picking it again would put it in twice.
        const { generator } = build({ sample: [candidate('A', 'One'), candidate('B', 'Two')] });

        const picks = await generator.generate({
            count: 2,
            rules: rotation,
            avoidSongKeys: new Set([songKey('A', ['One'])]),
        });

        expect(picks.map(pick => pick.title)).toEqual(['B']);
    });

    it('holds an artist queued inside the cooldown when there is enough else to draw', async () => {
        const { generator } = build({ sample: [candidate('A', 'One'), candidate('B', 'Two'), candidate('C', 'Three')] });

        const picks = await generator.generate({ count: 2, rules: rotation, queuedArtistKeys: new Set([artistKey(['One'])]) });

        expect(picks.map(pick => pick.artist).sort()).toEqual(['Three', 'Two']);
    });

    it('draws a queued artist after all on a library too small to fill the batch without them', async () => {
        // Every artist this library holds is already queued inside the cooldown. Holding them all
        // would hand back nothing and the running order would run down; the floor fills instead.
        const sample = [candidate('A', 'One'), candidate('B', 'Two'), candidate('C', 'Three')];
        const { generator } = build({ sample });

        const picks = await generator.generate({
            count: 3,
            rules: rotation,
            queuedArtistKeys: new Set([artistKey(['One']), artistKey(['Two']), artistKey(['Three'])]),
        });

        expect(picks).toHaveLength(3);
    });

    it('keeps at most the per-artist cap', async () => {
        const sample = [candidate('A', 'One'), candidate('B', 'One'), candidate('C', 'One'), candidate('D', 'Two')];
        const { generator } = build({ sample });

        const picks = await generator.generate({ count: 4, rules: { ...DEFAULT_RULES, maxPerArtist: 1 } });

        expect(picks.filter(pick => pick.artist === 'One')).toHaveLength(1);
    });

    it('never puts the same artist back to back', async () => {
        const sample = [candidate('A', 'One'), candidate('B', 'One'), candidate('C', 'Two'), candidate('D', 'Three')];
        const { generator } = build({ sample });

        const picks = await generator.generate({ count: 4, rules: { ...DEFAULT_RULES, maxPerArtist: 2 } });

        const artists = picks.map(pick => pick.artist);
        expect(artists.every((artist, index) => index === 0 || artist !== artists[index - 1])).toBe(true);
    });

    it('comes back short rather than empty when the library cannot fill the ask', async () => {
        // A small library under a wide repeat window genuinely has less to offer, and
        // the caller would rather have two tracks than an exception.
        const { generator } = build({ sample: [candidate('A', 'One'), candidate('B', 'Two')] });

        expect(await generator.generate({ count: 10, rules: rotation })).toHaveLength(2);
    });

    it('never returns more than it was asked for', async () => {
        const sample = Array.from({ length: 20 }, (_, index) => candidate(`T${index}`, `Artist${index}`));
        const { generator } = build({ sample });

        expect(await generator.generate({ count: 5, rules: rotation })).toHaveLength(5);
    });

    it('asks for nothing at all when nothing was asked of it', async () => {
        const { generator, candidates } = build();

        expect(await generator.generate({ count: 0, rules: rotation })).toEqual([]);
        expect(candidates.sample).not.toHaveBeenCalled();
    });

    it('refuses a disliked track even if the sample offered one', async () => {
        // The SQL already excludes these; the rule is applied again because it must
        // not depend on that having happened.
        const { generator } = build({ sample: [candidate('A', 'One', -1), candidate('B', 'Two')] });

        expect((await generator.generate({ count: 2, rules: rotation })).map(pick => pick.title)).toEqual(['B']);
    });

    it('hands the station advisory policy to the draw, so the SQL can narrow on it', async () => {
        const { generator, candidates } = build({ sample: [candidate('A', 'One')], settings: { [ADVISORY_KEY]: 'clean-only' } });
        await generator.generate({ count: 1, rules: rotation });

        expect(candidates.sample).toHaveBeenCalledWith(1, 'clean-only', undefined, {}, undefined);
    });

    it('narrows the draw by the PERIOD, which is the one thing the floor honours', async () => {
        // The distinction the whole binding turns on: a brief is an instruction and reading one
        // takes something that can read, while a year range is two integers. Approximating nothing
        // is what lets the thing that cannot fail act on it, and it is why a station asked for a
        // decade still plays one with no model configured.
        const { generator, candidates } = build({ sample: [candidate('A', 'One')] });

        await generator.generate({ count: 1, rules: rotation, era: { from: 1970, to: 1979 } });

        expect(candidates.sample).toHaveBeenCalledWith(1, 'prefer-explicit', { from: 1970, to: 1979 }, {}, undefined);
    });

    it('still ignores the brief beside it', async () => {
        const { generator } = build({ sample: [candidate('A', 'One')] });

        expect(await generator.generate({ count: 1, rules: rotation, brief: 'flamenco guitar' })).toHaveLength(1);
    });

    it('says the period starved it when the draw is empty and the same draw without it is not', async () => {
        // The period's own version of the second query below, and it is asked FIRST: an operator
        // chose the period for this broadcast and can undo it in one edit, where the advisory is a
        // standing station policy. A draw emptied by both would otherwise be reported as the harder
        // of the two to fix.
        const { generator, candidates, eraWatch } = build();
        vi.mocked(candidates.sample)
            .mockImplementationOnce(async () => [])
            .mockImplementationOnce(async () => [candidate('A', 'One'), candidate('B', 'Two')]);

        expect(await generator.generate({ count: 4, rules: rotation, era: { from: 1930, to: 1939 } })).toEqual([]);
        expect(eraWatch.starved).toHaveBeenCalledWith({ from: 1930, to: 1939 }, 2);
    });

    it('blames the period for nothing when the library is empty without it too', async () => {
        const { generator, eraWatch } = build();

        await generator.generate({ count: 4, rules: rotation, era: { from: 1930, to: 1939 } });

        expect(eraWatch.starved).not.toHaveBeenCalled();
    });

    it('clears the period watch on any draw that found something', async () => {
        const { generator, eraWatch } = build({ sample: [candidate('A', 'One')] });

        await generator.generate({ count: 1, rules: rotation, era: { from: 1970, to: 1979 } });

        expect(eraWatch.clear).toHaveBeenCalled();
    });

    it('says the policy starved it when the draw is empty and the same draw without it is not', async () => {
        // The whole point of the second query: a clean-only station with nothing marked clean and
        // one with an empty catalog are the same silence and want opposite fixes.
        const settings = { [ADVISORY_KEY]: 'clean-only' };
        const { generator, candidates, watch } = build({ settings });
        vi.mocked(candidates.sample)
            .mockImplementationOnce(async () => [])
            .mockImplementationOnce(async () => [candidate('A', 'One'), candidate('B', 'Two')]);

        expect(await generator.generate({ count: 4, rules: rotation })).toEqual([]);
        expect(watch.starved).toHaveBeenCalledWith(2);
    });

    it('blames nothing when the library is empty either way', async () => {
        // An empty catalog is not the policy's doing, and saying it was would send the operator to
        // change a setting that was never the problem.
        const { generator, watch } = build({ settings: { [ADVISORY_KEY]: 'clean-only' } });

        await generator.generate({ count: 4, rules: rotation });
        expect(watch.starved).not.toHaveBeenCalled();
    });

    it('does not go looking for a cause when the policy is not clean-only', async () => {
        // The second query is bought only in the state the station cannot programme out of.
        const { generator, candidates, watch } = build();

        await generator.generate({ count: 4, rules: rotation });
        expect(candidates.sample).toHaveBeenCalledTimes(1);
        expect(watch.starved).not.toHaveBeenCalled();
    });

    it('clears the mark as soon as it can draw again', async () => {
        const { generator, watch } = build({ sample: [candidate('A', 'One')], settings: { [ADVISORY_KEY]: 'clean-only' } });

        await generator.generate({ count: 1, rules: rotation });
        expect(watch.clear).toHaveBeenCalled();
    });
});

describe('CatalogSetGenerator under smart shuffle', () => {
    // The draw is `Math.random() * total` walked down the pool in order, so pinning the ticket at
    // the middle makes the weights the only thing deciding: with two equal weights the first record
    // wins, and anything that moves the answer is the lean doing its job.
    const pinTicket = () => vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const yesterday = () => DateTime.utc().minus({ days: 1 });

    it('draws the record nobody has heard over the one that aired yesterday', async () => {
        const random = pinTicket();
        const { generator } = build({
            sample: [candidate('Stale', 'One'), candidate('Fresh', 'Two')],
            lastAired: new Map([[songKey('Stale', ['One']), yesterday()]]),
        });

        const picks = await generator.generate({ count: 1, rules: rotation });

        expect(picks.map(pick => pick.title)).toEqual(['Fresh']);
        random.mockRestore();
    });

    it('draws exactly as it always did when it is switched off with the string the row holds', async () => {
        // Off has to restore the old draw, not approximate it: the same ticket over the same pool
        // takes the first record, however recently it aired.
        const random = pinTicket();
        const { generator, history } = build({
            sample: [candidate('Stale', 'One'), candidate('Fresh', 'Two')],
            lastAired: new Map([[songKey('Stale', ['One']), yesterday()]]),
            // Deep cuts off as well: with them on, the history is read for its whole retention anyway.
            settings: { [SMART_SHUFFLE_KEYS.enabled]: 'false', [REDISCOVER_KEYS.deepCuts]: 'false' },
        });

        const picks = await generator.generate({ count: 1, rules: rotation });

        expect(picks.map(pick => pick.title)).toEqual(['Stale']);
        // And it cost nothing: a horizon of zero days is the history read that runs no query.
        expect(history.lastAiredSince).toHaveBeenCalledWith(0, 'main');
        random.mockRestore();
    });

    it('weighs a record that aired a horizon ago like one that never has', async () => {
        const random = pinTicket();
        const { generator } = build({
            sample: [candidate('Old', 'One'), candidate('Never', 'Two')],
            lastAired: new Map([[songKey('Old', ['One']), DateTime.utc().minus({ days: DEFAULT_SMART_SHUFFLE_DAYS + 1 })]]),
        });

        expect((await generator.generate({ count: 1, rules: rotation })).map(pick => pick.title)).toEqual(['Old']);
        random.mockRestore();
    });

    it('asks the history for the horizon the operator set', async () => {
        const { generator, history } = build({
            sample: [candidate('A', 'One')],
            settings: { [SMART_SHUFFLE_KEYS.days]: '30', [REDISCOVER_KEYS.deepCuts]: 'false' },
        });

        await generator.generate({ count: 1, rules: rotation });

        expect(history.lastAiredSince).toHaveBeenCalledWith(30, 'main');
    });

    it('leans and never refuses, so a library of records that all aired yesterday still fills the ask', async () => {
        const sample = [candidate('A', 'One'), candidate('B', 'Two'), candidate('C', 'Three')];
        const { generator } = build({ sample, lastAired: new Map(sample.map(track => [songKey(track.title, [track.artist]), yesterday()])) });

        expect(await generator.generate({ count: 3, rules: rotation })).toHaveLength(3);
    });

    describe('a liked artist coming back', () => {
        const liked = (title: string, artist: string): CandidateTrack => ({ ...candidate(title, artist, 1), artistLiked: true });

        it('draws a liked artist the station has not aired in weeks over one it aired lately', async () => {
            const random = pinTicket();
            const { generator } = build({
                sample: [liked('Lately', 'Heard'), liked('Away', 'Quiet')],
                airedArtists: new Set([artistKey(['Heard'])]),
            });

            expect((await generator.generate({ count: 1, rules: rotation })).map(pick => pick.title)).toEqual(['Away']);
            random.mockRestore();
        });

        it('leans only on an artist the operator liked, never on a record liked by itself', async () => {
            const random = pinTicket();
            const { generator } = build({
                sample: [candidate('Liked Record', 'Somebody', 1), { ...candidate('Other', 'Else', 1) }],
                airedArtists: new Set([artistKey(['Else'])]),
            });

            // Neither artist is liked, so neither is coming back: equal weights, and the ticket takes the first.
            expect((await generator.generate({ count: 1, rules: rotation })).map(pick => pick.title)).toEqual(['Liked Record']);
            random.mockRestore();
        });

        it('draws as before, and reads nothing, when it is switched off with the string the row holds', async () => {
            // Off must not read an empty answer as "nobody aired", which would lean on every liked artist.
            const random = pinTicket();
            const { generator, history } = build({
                sample: [liked('Lately', 'Heard'), liked('Away', 'Quiet')],
                airedArtists: new Set([artistKey(['Heard'])]),
                settings: { [REDISCOVER_KEYS.artistReturn]: 'false' },
            });

            expect((await generator.generate({ count: 1, rules: rotation })).map(pick => pick.title)).toEqual(['Lately']);
            expect(history.artistKeysSince).toHaveBeenCalledWith(0, 'main');
            random.mockRestore();
        });

        it('asks the history for the window the operator set, in minutes', async () => {
            const { generator, history } = build({ sample: [liked('A', 'One')], settings: { [REDISCOVER_KEYS.artistReturnDays]: '30' } });

            await generator.generate({ count: 1, rules: rotation });

            expect(history.artistKeysSince).toHaveBeenCalledWith(30 * 24 * 60, 'main');
            expect(history.artistKeysSince).not.toHaveBeenCalledWith(DEFAULT_ARTIST_RETURN_DAYS * 24 * 60, 'main');
        });
    });

    describe('a deep cut', () => {
        const albumTrack = (title: string, artist: string, albumId: string, trackNumber?: number): CandidateTrack => ({
            ...candidate(title, artist),
            albumId,
            ...(trackNumber === undefined ? {} : { trackNumber }),
        });

        it('draws an unaired album track from an album the operator likes over an ordinary record', async () => {
            const random = pinTicket();
            const { generator } = build({
                sample: [candidate('Ordinary', 'One'), albumTrack('Track Nine', 'Two', 'liked-album', 9)],
                likedAlbums: new Set(['liked-album']),
            });

            expect((await generator.generate({ count: 1, rules: rotation })).map(pick => pick.title)).toEqual(['Track Nine']);
            random.mockRestore();
        });

        it('is not a deep cut once it has aired inside the history, however long ago', async () => {
            const random = pinTicket();
            const { generator } = build({
                sample: [candidate('Ordinary', 'One'), albumTrack('Track Nine', 'Two', 'liked-album', 9)],
                likedAlbums: new Set(['liked-album']),
                lastAired: new Map([[songKey('Track Nine', ['Two']), DateTime.utc().minus({ days: 90 })]]),
            });

            expect((await generator.generate({ count: 1, rules: rotation })).map(pick => pick.title)).toEqual(['Ordinary']);
            random.mockRestore();
        });

        it('never calls a record with no track number one, and never asks about it', async () => {
            const random = pinTicket();
            const { generator, candidates } = build({
                sample: [candidate('Ordinary', 'One'), albumTrack('No Number', 'Two', 'liked-album')],
                likedAlbums: new Set(['liked-album']),
            });

            expect((await generator.generate({ count: 1, rules: rotation })).map(pick => pick.title)).toEqual(['Ordinary']);
            expect(candidates.albumsWithLikes).toHaveBeenCalledWith([]);
            random.mockRestore();
        });

        it('reads the history for its whole retention, since "never aired here" is a claim about all of it', async () => {
            const { generator, history } = build({ sample: [candidate('A', 'One')] });

            await generator.generate({ count: 1, rules: rotation });

            expect(history.lastAiredSince).toHaveBeenCalledWith(PLAY_HISTORY_RETENTION_DAYS, 'main');
        });

        it('draws as before and asks nothing when it is switched off', async () => {
            const random = pinTicket();
            const { generator, candidates } = build({
                sample: [candidate('Ordinary', 'One'), albumTrack('Track Nine', 'Two', 'liked-album', 9)],
                likedAlbums: new Set(['liked-album']),
                settings: { [REDISCOVER_KEYS.deepCuts]: 'false' },
            });

            expect((await generator.generate({ count: 1, rules: rotation })).map(pick => pick.title)).toEqual(['Ordinary']);
            expect(candidates.albumsWithLikes).not.toHaveBeenCalled();
            random.mockRestore();
        });

        it('still draws when the albums cannot be read', async () => {
            const { generator } = build({ sample: [albumTrack('Track Nine', 'Two', 'liked-album', 9)], likedAlbumsFail: true });

            expect(await generator.generate({ count: 1, rules: rotation })).toHaveLength(1);
        });
    });

    describe('a genre steer', () => {
        it('draws the steered genre far more often, and still plays the rest', async () => {
            const soul = Array.from({ length: 10 }, (_, n) => candidate(`Soul ${n}`, `Soul Artist ${n}`));
            const other = Array.from({ length: 10 }, (_, n) => candidate(`Other ${n}`, `Other Artist ${n}`));
            const tags = Object.fromEntries([
                ...soul.map(track => [track.trackId, ['Northern Soul']]),
                ...other.map(track => [track.trackId, ['Rock']]),
            ]);
            const { generator } = build({ sample: [...soul.slice(0, 3), ...other], steer: { genres: ['Soul'], leaning: soul }, tags });

            let steeredDrawn = 0;
            let otherDrawn = 0;
            for (let run = 0; run < 40; run++) {
                const picks = await generator.generate({ count: 5, rules: DEFAULT_RULES, avoidSongKeys: new Set() } as never);
                steeredDrawn += picks.filter(pick => pick.title.startsWith('Soul')).length;
                otherDrawn += picks.filter(pick => pick.title.startsWith('Other')).length;
            }

            expect(steeredDrawn).toBeGreaterThan(otherDrawn * 2);
            expect(otherDrawn).toBeGreaterThan(0);
        });

        it('draws no extra sample and reads no tags when nothing is steering', async () => {
            const { generator, candidates } = build({ sample: [candidate('One', 'A')] });

            await generator.generate({ count: 1, rules: DEFAULT_RULES, avoidSongKeys: new Set() } as never);

            expect(candidates.sample).toHaveBeenCalledTimes(1);
            expect(candidates.tagsFor).not.toHaveBeenCalled();
        });
    });
});

describe('CatalogSetGenerator leaning toward a mood', () => {
    const judged = (shares: Partial<MoodDistribution>): MoodDistribution => ({
        love: 0,
        happiness: 0,
        comfort: 0,
        sadness: 0,
        loneliness: 0,
        anger: 0,
        fear: 0,
        ...shares,
    });
    // Pinning the ticket lets the weights decide, as the smart shuffle's cases do.
    const pinTicket = () => vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const off = { [SMART_SHUFFLE_KEYS.enabled]: 'false' };

    it('draws the record in the mood over one that is not', async () => {
        const random = pinTicket();
        const { generator } = build({
            sample: [candidate('Party', 'One'), candidate('Lullaby', 'Two')],
            moods: new Map([['id-Two-Lullaby', judged({ comfort: 0.8, love: 0.2 })]]),
            settings: off,
        });

        expect((await generator.generate({ count: 1, rules: rotation, mood: 'comfort' })).map(pick => pick.title)).toEqual(['Lullaby']);
        random.mockRestore();
    });

    it('asks nothing about moods for a broadcast that names none, and draws as before', async () => {
        const random = pinTicket();
        const { generator, labels } = build({ sample: [candidate('Party', 'One'), candidate('Lullaby', 'Two')], settings: off });

        expect((await generator.generate({ count: 1, rules: rotation })).map(pick => pick.title)).toEqual(['Party']);
        expect(labels.moodsForTracks).not.toHaveBeenCalled();
        random.mockRestore();
    });

    it('still draws when the moods cannot be read, as though none was named', async () => {
        const { generator } = build({ sample: [candidate('Party', 'One')], moodsFail: true, settings: off });
        expect(await generator.generate({ count: 1, rules: rotation, mood: 'comfort' })).toHaveLength(1);
    });

    it('never keeps a record off the air: a library of forty plays all forty, leaning or not', async () => {
        const sample = Array.from({ length: 40 }, (_, index) => candidate(`Song ${index}`, `Artist ${index}`));
        const { generator } = build({
            sample,
            moods: new Map(sample.slice(0, 5).map(track => [track.trackId, judged({ sadness: 1 })])),
            settings: off,
        });

        const picks = await generator.generate({ count: 40, rules: { ...rotation, artistCooldownMinutes: 0, repeatWindowDays: 0 }, mood: 'sadness' });

        expect(new Set(picks.map(pick => pick.title)).size).toBe(40);
    });

    it('makes a fitting record twice as likely, the factor a like gets, and no more', async () => {
        expect(MOOD_BOOST).toBe(2);
        const sample = [candidate('Fits', 'One'), candidate('Other', 'Two')];
        const { generator } = build({ sample, moods: new Map([['id-One-Fits', judged({ fear: 0.5, anger: 0.5 })]]), settings: off });

        let fits = 0;
        const draws = 3000;
        for (let index = 0; index < draws; index++) {
            const [pick] = await generator.generate({ count: 1, rules: rotation, mood: 'fear' });
            if (pick?.title === 'Fits') fits++;
        }

        // Two to one is two thirds. A generous band, because this is a draw.
        expect(fits / draws).toBeGreaterThan(0.6);
        expect(fits / draws).toBeLessThan(0.73);
    });
});

describe('CatalogSetGenerator under a never-play rule', () => {
    /**
     * A library of `size` records by as many artists, nine in ten of them a KIND of country (so the
     * SQL's exact test cannot see them and only the precise matcher refuses them), one in twenty of
     * the rest tagged plain `country` (which the SQL leaves out), and the remainder rock.
     */
    function mostlyCountry(size: number) {
        const library: CandidateTrack[] = [];
        const tags: Record<string, string[]> = {};
        for (let index = 0; index < size; index++) {
            const track = candidate(`Song ${index}`, `Artist ${index}`);
            library.push(track);
            tags[track.trackId] = index % 10 === 0 ? ['Rock'] : index % 20 === 1 ? ['country'] : ['Country Pop'];
        }
        return { library, tags };
    }

    const country: BlockRule = { id: 'r1', field: 'genre', value: 'Country' };

    it('is not starved by a library the rule refuses most of', async () => {
        const { library, tags } = mostlyCountry(2000);
        const { generator, candidates } = build({ library, tags, neverPlay: [country] });

        const picks = await generator.generate({ count: 20, rules: rotation });

        // One ordinary sample of this library is 240 records of which about 24 are rock. Drawn,
        // weighed and chosen among without the rule, most of a batch of 20 was country, and the
        // resolver refusing it afterwards left the refill a handful of records.
        expect(picks).toHaveLength(20);
        expect(picks.every(pick => tags[pick.trackId!]![0] === 'Rock')).toBe(true);
        // The draws after the first are sized from its refusals, up to the ceiling a sample has.
        const sizes = vi.mocked(candidates.sample).mock.calls.map(call => sampleSize(call[0] as number));
        expect(sizes[0]).toBe(240);
        expect(sizes[1]).toBe(500);
    });

    it('asks the SQL to leave out what is tagged exactly the rule, and never what was drawn already', async () => {
        const { library, tags } = mostlyCountry(2000);
        const { generator, candidates } = build({ library, tags, neverPlay: [country] });

        await generator.generate({ count: 20, rules: rotation });

        const calls = vi.mocked(candidates.sample).mock.calls;
        expect(calls[0]![5]).toEqual({ refusedTags: ['Country'], trackIds: [] });
        expect((calls[1]![5] as SampleExclusions).trackIds).toHaveLength(sampleSize(20));
    });

    it('draws no more than once when nothing is refused', async () => {
        const { library, tags } = mostlyCountry(2000);
        const { generator, candidates } = build({ library, tags });

        await generator.generate({ count: 20, rules: rotation });

        expect(candidates.sample).toHaveBeenCalledTimes(1);
        expect(vi.mocked(candidates.sample).mock.calls[0]![5]).toBeUndefined();
    });

    it('stops drawing once the library has run out', async () => {
        const { library, tags } = mostlyCountry(40);
        const { generator, candidates } = build({ library, tags, neverPlay: [country] });

        const picks = await generator.generate({ count: 20, rules: rotation });

        expect(picks.map(pick => pick.title).sort()).toEqual(['Song 0', 'Song 10', 'Song 20', 'Song 30']);
        expect(candidates.sample).toHaveBeenCalledTimes(1);
    });

    it('judges a rule limited to a mode against the broadcast it is drawing for', async () => {
        const { library, tags } = mostlyCountry(200);
        const inFeatures: BlockRule = { ...country, modes: ['feature'] };

        const forRotation = build({ library, tags, neverPlay: [inFeatures] });
        await forRotation.generator.generate({ count: 5, rules: rotation, broadcast: { mode: 'rotation' } });
        expect(vi.mocked(forRotation.candidates.sample).mock.calls[0]![5]).toBeUndefined();

        const forFeature = build({ library, tags, neverPlay: [inFeatures] });
        const picks = await forFeature.generator.generate({ count: 5, rules: rotation, broadcast: { mode: 'feature' } });
        expect(picks.every(pick => tags[pick.trackId!]![0] === 'Rock')).toBe(true);
    });

    it('draws as it would with no rules when the rules cannot be read, leaving the refusal to the resolver', async () => {
        const { library, tags } = mostlyCountry(200);
        const { generator, candidates } = build({ library, tags, neverPlayFails: true });

        expect(await generator.generate({ count: 5, rules: rotation })).toHaveLength(5);
        expect(vi.mocked(candidates.sample).mock.calls[0]![5]).toBeUndefined();
    });
});
