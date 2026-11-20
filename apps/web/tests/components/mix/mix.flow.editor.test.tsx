// The mix flow canvas's own frame: the heading it draws as a page would, the strip saying what would
// stop the flow running, and Use this flow, which is refused while there is something to put right.

import { describe, expect, it, vi } from 'vitest';
import type { MixFlow } from '@deadair/sdk';

import { MixFlowEditor } from '../../../src/components/mix/mix.flow.editor';
import { render, screen, setupUser } from '../../utils/render';

vi.mock('../../../src/api/client', () => ({ sdk: { schedule: { draftMixFlow: vi.fn() } } }));

const runs: MixFlow = {
    version: 1,
    nodes: [
        { id: 'picks', kind: 'picks', x: 0, y: 0 },
        { id: 'noRepeat-1', kind: 'noRepeat', x: 300, y: 0 },
        { id: 'air', kind: 'onAir', x: 600, y: 0 },
    ],
    links: [
        { from: 'picks', out: 0, to: 'noRepeat-1', in: 0 },
        { from: 'noRepeat-1', out: 0, to: 'air', in: 0 },
    ],
};

describe('MixFlowEditor', () => {
    it('is headed as a page of its show, and hands back a flow that runs', async () => {
        const onDone = vi.fn();
        const user = setupUser();
        render(<MixFlowEditor opened flow={runs} title="Church" onDone={onDone} onClose={vi.fn()} />);

        expect(await screen.findByText('Programme › Church')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Mix flow' })).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('3 nodes · 2 wires');
        expect(screen.getByText('Every record has a way to On air.')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Use this flow' }));
        expect(onDone).toHaveBeenCalledWith(runs);
    });

    it('refuses Use this flow while something would stop the flow running, and says what', async () => {
        const loose: MixFlow = { ...runs, links: runs.links.slice(0, 1) };
        render(<MixFlowEditor opened flow={loose} onDone={vi.fn()} onClose={vi.fn()} />);

        expect(await screen.findByText('Programme › New show')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Use this flow' })).toBeDisabled();
        expect(screen.getByRole('status')).toHaveTextContent('No two in a row (noRepeat-1) leads nowhere. Wire it on toward On air.');
    });

    it('draws a bypassed node as bypassed, with its wires still checked', async () => {
        const bypassed: MixFlow = { ...runs, nodes: runs.nodes.map(node => (node.id === 'noRepeat-1' ? { ...node, bypassed: true } : node)) };
        render(<MixFlowEditor opened flow={bypassed} onDone={vi.fn()} onClose={vi.fn()} />);

        expect(await screen.findByText('Bypassed')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Use this flow' })).toBeEnabled();
    });

    it('adds a rule found by typing, and shows on Picks what the show proposes from', async () => {
        const onDone = vi.fn();
        const user = setupUser();
        render(<MixFlowEditor opened flow={runs} brief="Warm and unhurried" period={{ from: 1970 }} onDone={onDone} onClose={vi.fn()} />);

        expect(await screen.findByText('Asked to play “Warm and unhurried”')).toBeInTheDocument();
        expect(screen.getByText('Records from 1970 on')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Add a rule' }));
        await user.type(await screen.findByRole('textbox', { name: 'Find a rule' }), 'percent{Enter}');

        expect(await screen.findByText('Limit share')).toBeInTheDocument();
        // A rule added on its own is not wired, so the flow is not ready until it is.
        expect(screen.getByRole('button', { name: 'Use this flow' })).toBeDisabled();
    });
});

describe('MixFlowEditor, a split by energy', () => {
    const byEnergy: MixFlow = {
        version: 1,
        nodes: [
            { id: 'picks', kind: 'picks', x: 0, y: 0 },
            { id: 'split-1', kind: 'split', splitBy: 'energy', branches: [{ values: ['high'] }], x: 300, y: 0 },
            { id: 'merge-1', kind: 'merge', x: 600, y: 0 },
            { id: 'air', kind: 'onAir', x: 900, y: 0 },
        ],
        links: [
            { from: 'picks', out: 0, to: 'split-1', in: 0 },
            { from: 'split-1', out: 0, to: 'merge-1', in: 0 },
            { from: 'split-1', out: 1, to: 'merge-1', in: 1 },
            { from: 'merge-1', out: 0, to: 'air', in: 0 },
        ],
    };

    it('reads its basis as measured energy and its branch as a third of the library, and hands the flow back as drawn', async () => {
        const onDone = vi.fn();
        render(<MixFlowEditor opened flow={byEnergy} onDone={onDone} onClose={vi.fn()} />);

        expect(await screen.findByDisplayValue('measured energy')).toBeInTheDocument();
        expect(screen.getAllByText('liveliest third').length).toBeGreaterThan(0);
        expect(screen.getByText('Every record has a way to On air.')).toBeInTheDocument();

        await setupUser().click(screen.getByRole('button', { name: 'Use this flow' }));
        expect(onDone).toHaveBeenCalledWith(byEnergy);
    });
});
