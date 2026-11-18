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
});
