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
import type { PlayHistoryRepository } from '../../../src/modules/director/play.history.repository.js';
import { artistKey, songKey } from '../../../src/modules/director/rotation.keys.js';
import { DEFAULT_RULES, resolveRules } from '../../../src/modules/director/rotation.rules.js';
import { DEFAULT_SMART_SHUFFLE_DAYS, SMART_SHUFFLE_KEYS } from '../../../src/modules/director/smart.shuffle.js';
import { StationIdentity } from '../../../src/modules/shared/station.identity.js';
import type { BlockRulesRepository } from '../../../src/modules/director/block.rules.repository.js';
import type { LyricLabelsRepository } from '../../../src/modules/lyrics/lyric.labels.repository.js';
import type { MoodDistribution } from '../../../src/modules/lyrics/lyric.moods.js';
import { MOOD_BOOST } from '../../../src/modules/director/mood.lean.js';

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
}

function build(options: Options = {}) {
    const candidates = {
        sample: vi.fn(async (...args: unknown[]) => (args[4] === undefined ? (options.sample ?? []) : (options.steer?.leaning ?? []))),
        tagsFor: vi.fn(async (ids: readonly string[]) => new Map(ids.flatMap(id => (options.tags?.[id] ? [[id, options.tags[id]!]] : [])))),
    } as unknown as CandidatesRepository;
    const rules = {
        steer: vi.fn(async () => (options.steer === undefined ? undefined : { genres: options.steer.genres, endsAt: '2099-01-01T00:00:00.000Z' })),
    } as unknown as BlockRulesRepository;

    const history = {
        songKeysSince: vi.fn(async (days: number) => (days > 0 ? (options.songKeys ?? new Set()) : new Set())),
        artistKeysSince: vi.fn(async (minutes: number) => (minutes > 0 ? (options.artistKeys ?? new Set()) : new Set())),
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
        generator: new CatalogSetGenerator(candidates, rules, history, new StationIdentity(), config, watch, eraWatch, labels),
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

        expect(candidates.sample).toHaveBeenCalledWith(1, 'clean-only', undefined, {});
    });

    it('narrows the draw by the PERIOD, which is the one thing the floor honours', async () => {
        // The distinction the whole binding turns on: a brief is an instruction and reading one
        // takes something that can read, while a year range is two integers. Approximating nothing
        // is what lets the thing that cannot fail act on it, and it is why a station asked for a
        // decade still plays one with no model configured.
        const { generator, candidates } = build({ sample: [candidate('A', 'One')] });

        await generator.generate({ count: 1, rules: rotation, era: { from: 1970, to: 1979 } });

        expect(candidates.sample).toHaveBeenCalledWith(1, 'prefer-explicit', { from: 1970, to: 1979 }, {});
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
            settings: { [SMART_SHUFFLE_KEYS.enabled]: 'false' },
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
        const { generator, history } = build({ sample: [candidate('A', 'One')], settings: { [SMART_SHUFFLE_KEYS.days]: '30' } });

        await generator.generate({ count: 1, rules: rotation });

        expect(history.lastAiredSince).toHaveBeenCalledWith(30, 'main');
    });

    it('leans and never refuses, so a library of records that all aired yesterday still fills the ask', async () => {
        const sample = [candidate('A', 'One'), candidate('B', 'Two'), candidate('C', 'Three')];
        const { generator } = build({ sample, lastAired: new Map(sample.map(track => [songKey(track.title, [track.artist]), yesterday()])) });

        expect(await generator.generate({ count: 3, rules: rotation })).toHaveLength(3);
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
