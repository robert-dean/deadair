// Records in the steered genres, from a source that knows what is tagged with them. What is pinned:
// it is inert without a steer, a source, or a share; it takes only its share; it names each artist
// once and nothing the batch is avoiding or the cooldown holds; and it declares itself deaf to the
// brief, so a binding brief leaves it out.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import type { ArtistTrack } from '@deadair/plugin-sdk';

import { DEFAULT_TAG_MIX, TAG_GENERATOR_KEYS, TagSetGenerator, choose } from '../../../src/modules/director/tag.set.generator.js';
import type { SimilarityService } from '../../../src/modules/similarity/similarity.service.js';
import type { BlockRulesRepository } from '../../../src/modules/director/block.rules.repository.js';
import type { PlayHistoryRepository } from '../../../src/modules/director/play.history.repository.js';
import { DEFAULT_RULES } from '../../../src/modules/director/rotation.rules.js';
import { songKey } from '../../../src/modules/director/rotation.keys.js';
import type { SetInputs } from '../../../src/modules/director/set.generator.js';
import { StationIdentity } from '../../../src/modules/shared/station.identity.js';
import { DISCOVER_KEY } from '../../../src/modules/director/pick.resolver.js';
import { TagWatch } from '../../../src/modules/director/tag.watch.js';
import type { ActivityRecorder } from '../../../src/modules/activity/activity.recorder.js';

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

const inputs = (extra: Partial<SetInputs> = {}): SetInputs => ({ count: 8, rules: DEFAULT_RULES, ...extra }) as SetInputs;

const records = (...pairs: [string, string][]): ArtistTrack[] => pairs.map(([title, artist]) => ({ title, artist }));

interface Build {
    settings?: Record<string, string>;
    steer?: { genres: string[] };
    tagged?: ArtistTrack[];
    canNameTagged?: boolean;
    cooled?: string[];
    /** Whether a source answered, as against failing. */
    answered?: boolean;
}

function build({ settings = {}, steer = { genres: ['synthwave'] }, tagged = [], canNameTagged = true, cooled = [], answered = true }: Build = {}) {
    const tracksForTags = vi.fn(async () => ({ tracks: tagged, answered }));
    const similarity = { canNameTagged: () => canNameTagged, askTagged: tracksForTags } as unknown as SimilarityService;
    const rules = {
        steer: vi.fn(async () => (steer.genres.length === 0 ? undefined : { ...steer, endsAt: '2026-11-07T00:00:00.000Z' })),
    } as unknown as BlockRulesRepository;
    const history = { artistKeysSince: vi.fn(async () => new Set(cooled)) } as unknown as PlayHistoryRepository;
    // Strings, as every layer of AppConfig holds.
    const config = { get: (key: string, fallback?: unknown) => (key in settings ? settings[key] : fallback) } as unknown as AppConfig;
    const warn = vi.fn();
    const watch = { nothingTagged: vi.fn(), found: vi.fn() };
    const generator = new TagSetGenerator(
        similarity,
        rules,
        history,
        new StationIdentity(),
        config,
        { ...logger, warn } as unknown as Logger,
        watch as unknown as TagWatch,
    );
    return { generator, tracksForTags, warn, watch };
}

const many = records(
    ['Prism', 'Kalax'],
    ['Hollywood Heights', 'Mitch Murder'],
    ['Dusk', 'Waveshaper'],
    ['Turbo Killer', 'Carpenter Brut'],
    ['Nightcall', 'Kavinsky'],
    ['Sunset', 'The Midnight'],
);

describe('TagSetGenerator', () => {
    it('is deaf to the brief, and says so', () => {
        expect(build().generator.ignoresBrief).toBe(true);
    });

    it('asks the source for any of the steered genres and takes only its share of the refill', async () => {
        const { generator, tracksForTags } = build({ steer: { genres: ['synthwave', 'outrun'] }, tagged: many });

        const picks = await generator.generate(inputs({ count: 8 }));

        expect(tracksForTags).toHaveBeenCalledWith(['synthwave', 'outrun'], 'any', expect.any(Number));
        expect(picks).toHaveLength(Math.round(8 * DEFAULT_TAG_MIX));
        expect(picks[0]).toEqual({ title: 'Prism', artist: 'Kalax' });
    });

    it('asks for nothing with no steer in force', async () => {
        const { generator, tracksForTags } = build({ steer: { genres: [] }, tagged: many });
        expect(await generator.generate(inputs())).toEqual([]);
        expect(tracksForTags).not.toHaveBeenCalled();
    });

    it('asks for nothing when no source can name records by tag', async () => {
        const { generator, tracksForTags } = build({ canNameTagged: false, tagged: many });
        expect(await generator.generate(inputs())).toEqual([]);
        expect(tracksForTags).not.toHaveBeenCalled();
    });

    it('is off at a mix of 0, read as the STRING it is stored as, and a mix nobody can read is off too', async () => {
        for (const mix of ['0', 'lots']) {
            const { generator, tracksForTags } = build({ settings: { [TAG_GENERATOR_KEYS.mix]: mix }, tagged: many });
            expect(await generator.generate(inputs())).toEqual([]);
            expect(tracksForTags).not.toHaveBeenCalled();
        }
    });

    it('takes a larger share when the operator set one', async () => {
        const { generator } = build({ settings: { [TAG_GENERATOR_KEYS.mix]: '0.5' }, tagged: many });
        expect(await generator.generate(inputs({ count: 8 }))).toHaveLength(4);
    });

    it('holds an artist the cooldown holds', async () => {
        const { generator } = build({ settings: { [TAG_GENERATOR_KEYS.mix]: '1' }, tagged: many, cooled: ['kalax'] });
        const picks = await generator.generate(inputs({ count: 8 }));
        expect(picks.map(pick => pick.artist)).not.toContain('Kalax');
    });

    it('warns once when discovery is off, because records it does not own then cannot air', async () => {
        const { generator, warn } = build({ settings: { [DISCOVER_KEY]: 'false' }, tagged: many });
        await generator.generate(inputs());
        await generator.generate(inputs());
        expect(warn).toHaveBeenCalledTimes(1);
    });
});

describe('a steered genre nobody tags', () => {
    it('is reported when a source answered empty, and not when every source failed', async () => {
        const empty = build({ tagged: [] });
        await empty.generator.generate(inputs());
        expect(empty.watch.nothingTagged).toHaveBeenCalledWith(['synthwave']);

        const failed = build({ tagged: [], answered: false });
        await failed.generator.generate(inputs());
        expect(failed.watch.nothingTagged).not.toHaveBeenCalled();
    });

    it('clears once the genres find records', async () => {
        const { generator, watch } = build({ tagged: many });
        await generator.generate(inputs());
        expect(watch.found).toHaveBeenCalled();
    });

    it('writes one warning per steer, and a new one once the genres change or recover', () => {
        const record = vi.fn(async (_event: unknown) => undefined);
        const watch = new TagWatch({ record } as unknown as ActivityRecorder, logger);

        watch.nothingTagged(['Synthwav']);
        watch.nothingTagged(['synthwav']);
        expect(record).toHaveBeenCalledTimes(1);
        expect(record.mock.calls[0]?.[0]).toMatchObject({ kind: 'rotation.steerUntagged', severity: 'warn', data: { genres: ['Synthwav'] } });

        watch.nothingTagged(['vaporwav']);
        expect(record).toHaveBeenCalledTimes(2);

        watch.found();
        watch.nothingTagged(['vaporwav']);
        expect(record).toHaveBeenCalledTimes(3);
    });
});

describe('choosing from what the source named', () => {
    it('takes each artist once, in the order given', () => {
        const picks = choose(records(['A', 'Kalax'], ['B', 'Kalax'], ['C', 'Mitch Murder']), 5, inputs(), new Set());
        expect(picks.map(pick => pick.title)).toEqual(['A', 'C']);
    });

    it('leaves out a record the batch is avoiding and one by a held artist', () => {
        const avoided = inputs({ avoidSongKeys: new Set([songKey('A', ['Kalax'])]) });
        const picks = choose(records(['A', 'Kalax'], ['C', 'Mitch Murder'], ['D', 'Waveshaper']), 5, avoided, new Set(['waveshaper']));
        expect(picks.map(pick => pick.title)).toEqual(['C']);
    });

    it('leaves out a record whose known year is outside the period, and keeps one whose year nobody recorded', () => {
        const named = [
            { title: 'Old', artist: 'Kalax', year: 1979 },
            { title: 'New', artist: 'Mitch Murder', year: 2015 },
            { title: 'Undated', artist: 'Waveshaper' },
        ];
        expect(choose(named, 5, inputs({ era: { from: 2000 } }), new Set()).map(pick => pick.title)).toEqual(['New', 'Undated']);
    });
});
