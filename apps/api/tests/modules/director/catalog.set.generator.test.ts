// The generator is where the rules actually meet the library, so what matters
// here is that it applies them at all — a station whose repeat window is
// computed and then ignored sounds exactly like one with no window — and that a
// library too small to satisfy them comes back short rather than empty-handed or
// repeating itself.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import type { AdvisoryWatch } from '../../../src/modules/director/advisory.watch.js';
import { ADVISORY_KEY } from '../../../src/modules/director/advisory.policy.js';
import { CatalogSetGenerator } from '../../../src/modules/director/catalog.set.generator.js';
import type { CandidatesRepository, CandidateTrack } from '../../../src/modules/director/candidates.repository.js';
import type { PlayHistoryRepository } from '../../../src/modules/director/play.history.repository.js';
import { artistKey, songKey } from '../../../src/modules/director/rotation.keys.js';
import { DEFAULT_RULES, resolveRules } from '../../../src/modules/director/rotation.rules.js';
import { StationIdentity } from '../../../src/modules/shared/station.identity.js';

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
    settings?: Record<string, unknown>;
}

function build(options: Options = {}) {
    const candidates = {
        sample: vi.fn(async () => options.sample ?? []),
    } as unknown as CandidatesRepository;

    const history = {
        songKeysSince: vi.fn(async (days: number) => (days > 0 ? (options.songKeys ?? new Set()) : new Set())),
        artistKeysSince: vi.fn(async (minutes: number) => (minutes > 0 ? (options.artistKeys ?? new Set()) : new Set())),
    } as unknown as PlayHistoryRepository;

    const settings: Record<string, unknown> = { ...options.settings };
    const config = {
        get: vi.fn((key: string, fallback?: unknown) => (key in settings ? settings[key] : fallback)),
    } as unknown as AppConfig;

    const watch = { starved: vi.fn(), clear: vi.fn() } as unknown as AdvisoryWatch;

    return { generator: new CatalogSetGenerator(candidates, history, new StationIdentity(), config, watch), candidates, history, watch };
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

        expect(candidates.sample).toHaveBeenCalledWith(1, 'clean-only');
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
