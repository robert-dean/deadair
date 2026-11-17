// The canvas's own reading of a mix flow: what would stop it running, marked on the node while it is
// drawn, and the wires a split keeps on the branch they were drawn from when its branches change.

import { describe, expect, it } from 'vitest';
import type { MixFlow } from '@deadair/sdk';

import { flowProblems, freshNode, nextId, relinkSplit, songOf, starterFlow } from '../../../src/components/mix/mix.kinds';
import { mixFlowInput } from '../../../src/components/schedule/slot.editor';

const split: MixFlow = {
    version: 1,
    nodes: [
        { id: 'picks', kind: 'picks' },
        { id: 'split', kind: 'split', splitBy: 'genre', branches: [{ values: ['black metal'] }, { values: ['pop'] }] },
        { id: 'air', kind: 'onAir' },
    ],
    links: [
        { from: 'picks', out: 0, to: 'split', in: 0 },
        { from: 'split', out: 0, to: 'air', in: 0 },
        { from: 'split', out: 2, to: 'air', in: 0 },
    ],
};

describe('flowProblems', () => {
    it('finds nothing wrong with Picks wired straight to On air', () => {
        expect(flowProblems(starterFlow())).toEqual([]);
    });

    it("marks a split's loose branch on its node, by output", () => {
        expect(flowProblems(split)).toEqual([{ nodeId: 'split', kind: 'branchLeadsNowhere', output: 1 }]);
    });

    it('asks a fresh node for the setting it still needs', () => {
        const flow: MixFlow = { ...starterFlow(), nodes: [...starterFlow().nodes, freshNode('block', 'block-1', { x: 0, y: 0 })] };
        expect(flowProblems(flow)).toEqual(
            expect.arrayContaining([
                { nodeId: 'block-1', kind: 'leadsNowhere' },
                { nodeId: 'block-1', kind: 'nothingWiredIn' },
                { nodeId: 'block-1', kind: 'noBands' },
            ]),
        );
    });
});

describe('relinkSplit', () => {
    it('drops the wire of a removed branch and moves the later ones up', () => {
        expect(relinkSplit(split.links, 'split', { removed: 0 })).toEqual([
            { from: 'picks', out: 0, to: 'split', in: 0 },
            { from: 'split', out: 1, to: 'air', in: 0 },
        ]);
    });

    it('keeps "everything else" on its wire when a branch is added before it', () => {
        expect(relinkSplit(split.links, 'split', { addedAt: 2 }).find(link => link.from === 'split' && link.out === 3)).toBeDefined();
    });
});

describe('the small helpers', () => {
    it('reads a record as its title and artist, either dash', () => {
        expect(songOf('Thriller — Michael Jackson')).toEqual({ title: 'Thriller', artist: 'Michael Jackson' });
        expect(songOf('Toxic - Britney Spears')).toEqual({ title: 'Toxic', artist: 'Britney Spears' });
        expect(songOf('Thriller')).toBeUndefined();
    });

    it('names a new node by its kind and the next free number', () => {
        expect(nextId('block', [{ id: 'block-1' }, { id: 'picks' }])).toBe('block-2');
    });
});

describe('mixFlowInput', () => {
    it('sends a flow, clears a removed one with no nodes, and otherwise says nothing so the show keeps its own', () => {
        expect(mixFlowInput(split, undefined)).toEqual({ mixFlow: split });
        expect(mixFlowInput({ version: 1, nodes: [], links: [] }, split)).toEqual({ mixFlow: { version: 1, nodes: [], links: [] } });
        expect(mixFlowInput(undefined, undefined)).toEqual({});
    });
});
