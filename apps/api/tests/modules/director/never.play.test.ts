// What a judging pass reads. A genre or tag rule reads the tags and a version rule reads the title and
// album, each only when a rule holding needs it, so a station with one kind of rule pays for one read.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { compileRules, type BlockRule } from '../../../src/modules/director/block.rules.js';
import type { BlockRulesRepository } from '../../../src/modules/director/block.rules.repository.js';
import type { CandidatesRepository } from '../../../src/modules/director/candidates.repository.js';
import { NeverPlay } from '../../../src/modules/director/never.play.js';

function build() {
    const candidates = {
        tagsFor: vi.fn(async () => new Map([['jolene', ['Country']]])),
        namesFor: vi.fn(
            async () =>
                new Map([
                    ['war-pigs', { title: 'War Pigs - Live', album: 'The End (Live)' }],
                    ['live-wire', { title: 'Live Wire', album: 'High Voltage' }],
                ]),
        ),
    } as unknown as CandidatesRepository;
    const neverPlay = new NeverPlay({ list: vi.fn(async () => []) } as unknown as BlockRulesRepository, candidates, {} as AppConfig);
    return { neverPlay, candidates };
}

const rules = (...list: BlockRule[]) => compileRules(list);
const ids = ['jolene', 'war-pigs', 'live-wire'];

describe('NeverPlay.blockedUnder', () => {
    it('reads titles and albums for a version rule, and no tags', async () => {
        const { neverPlay, candidates } = build();

        const blocked = await neverPlay.blockedUnder(rules({ id: 'no-live', field: 'version', value: 'live' }), ids);

        expect([...blocked.keys()]).toEqual(['war-pigs']);
        expect(candidates.tagsFor).not.toHaveBeenCalled();
    });

    it('reads tags for a genre rule, and no titles', async () => {
        const { neverPlay, candidates } = build();

        const blocked = await neverPlay.blockedUnder(rules({ id: 'no-country', field: 'genre', value: 'Country' }), ids);

        expect([...blocked.keys()]).toEqual(['jolene']);
        expect(candidates.namesFor).not.toHaveBeenCalled();
    });

    it('reads both when both kinds hold, and names the rule each record fell under', async () => {
        const { neverPlay } = build();

        const blocked = await neverPlay.blockedUnder(
            rules({ id: 'no-country', field: 'genre', value: 'Country' }, { id: 'no-live', field: 'version', value: 'live' }),
            ids,
        );

        expect(Object.fromEntries([...blocked].map(([id, rule]) => [id, rule.id]))).toEqual({ jolene: 'no-country', 'war-pigs': 'no-live' });
    });
});
