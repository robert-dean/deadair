// What a show's mix flow requires, added first in a refill: from the records a require node lists, the
// one aired longest ago; else a library record whose band's main genre matches. Each pick names its
// node, so the resolver walks it from there.

import { DateTime } from 'luxon';
import { describe, expect, it, vi } from 'vitest';

import type { CandidatesRepository } from '../../../src/modules/director/candidates.repository.js';
import type { MixInForce } from '../../../src/modules/director/mix.flow.js';
import { MixRequireSetGenerator } from '../../../src/modules/director/mix.require.set.generator.js';
import type { PlayHistoryRepository } from '../../../src/modules/director/play.history.repository.js';
import { songKey } from '../../../src/modules/director/rotation.keys.js';
import type { SetInputs } from '../../../src/modules/director/set.generator.js';
import type { MixNode } from '../../../src/modules/schedule/types/mix.types.js';
import type { StationIdentity } from '../../../src/modules/shared/station.identity.js';

const RULES = { artistCooldownMinutes: 0, maxPerArtist: 0 } as SetInputs['rules'];

const mixWith = (node: MixNode, showProgress = 50): MixInForce => ({
    flow: {
        version: 1,
        nodes: [{ id: 'picks', kind: 'picks' }, node, { id: 'merge', kind: 'merge' }, { id: 'air', kind: 'onAir' }],
        links: [
            { from: 'picks', out: 0, to: 'merge', in: 0 },
            { from: node.id, out: 0, to: 'merge', in: 1 },
            { from: 'merge', out: 0, to: 'air', in: 0 },
        ],
    },
    ctx: { hour: 20, showProgress, counted: [] },
});

function build(options: { lastAired?: Record<string, number>; library?: { trackId: string; title: string; artist: string; genre: string }[] } = {}) {
    const candidates = { sampleByMainGenre: vi.fn(async () => options.library ?? []) } as unknown as CandidatesRepository;
    const history = {
        lastAiredSince: vi.fn(
            async () => new Map(Object.entries(options.lastAired ?? {}).map(([key, hoursAgo]) => [key, DateTime.utc().minus({ hours: hoursAgo })])),
        ),
    } as unknown as PlayHistoryRepository;
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } as never;
    return { generator: new MixRequireSetGenerator(candidates, history, { stationKey: 'main' } as StationIdentity, logger), candidates };
}

const pop: MixNode = {
    id: 'pop',
    kind: 'require',
    requireGenres: ['pop'],
    afterPercent: 40,
    songs: [
        { title: 'Thriller', artist: 'Michael Jackson' },
        { title: 'Toxic', artist: 'Britney Spears' },
    ],
};

describe('MixRequireSetGenerator', () => {
    it('adds nothing for a show with no flow, or before the requirement is due', async () => {
        const { generator } = build();
        expect(await generator.generate({ count: 5, rules: RULES })).toEqual([]);
        expect(await generator.generate({ count: 5, rules: RULES, mix: mixWith(pop, 20) })).toEqual([]);
    });

    it('takes the listed record aired longest ago, naming its node', async () => {
        const { generator } = build({ lastAired: { [songKey('Thriller', ['Michael Jackson'])]: 2, [songKey('Toxic', ['Britney Spears'])]: 200 } });
        expect(await generator.generate({ count: 5, rules: RULES, mix: mixWith(pop) })).toEqual([
            { title: 'Toxic', artist: 'Britney Spears', mixEntry: 'pop' },
        ]);
    });

    it('passes over a listed record the order already holds', async () => {
        const { generator } = build();
        const picks = await generator.generate({
            count: 5,
            rules: RULES,
            mix: mixWith(pop),
            avoidSongKeys: new Set([songKey('Thriller', ['Michael Jackson'])]),
        });
        expect(picks.map(pick => pick.title)).toEqual(['Toxic']);
    });

    it('draws a library record whose main genre refines the one required, when no records are listed', async () => {
        const { generator } = build({
            library: [
                { trackId: 't1', title: 'Pop Punk Song', artist: 'Somebody', genre: 'pop punk' },
                { trackId: 't2', title: 'Oh Happy Day', artist: 'Edwin Hawkins Singers', genre: 'gospel' },
            ],
        });
        const gospel: MixNode = { id: 'gospel', kind: 'require', requireGenres: ['gospel'] };
        expect(await generator.generate({ count: 5, rules: RULES, mix: mixWith(gospel) })).toEqual([
            { title: 'Oh Happy Day', artist: 'Edwin Hawkins Singers', trackId: 't2', mixEntry: 'gospel' },
        ]);
    });
});
