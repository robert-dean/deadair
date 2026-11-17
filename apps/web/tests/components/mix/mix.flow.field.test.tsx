// The mix flow on the slot editor: what the show has, the canvas that draws it, and removing it, which
// sends a flow with no nodes because a save that says nothing keeps what the show had.

import { describe, expect, it, vi } from 'vitest';
import type { MixFlow } from '@deadair/sdk';

import { MixFlowField } from '../../../src/components/mix/mix.flow.field';
import { render, screen, setupUser } from '../../utils/render';

const flow: MixFlow = {
    version: 1,
    nodes: [
        { id: 'picks', kind: 'picks', x: 0, y: 0 },
        { id: 'block-1', kind: 'block', bands: ['Burzum'], x: 300, y: 0 },
        { id: 'air', kind: 'onAir', x: 600, y: 0 },
    ],
    links: [
        { from: 'picks', out: 0, to: 'block-1', in: 0 },
        { from: 'block-1', out: 0, to: 'air', in: 0 },
    ],
};

describe('MixFlowField', () => {
    it('says a show has no flow and offers to draw one', () => {
        render(<MixFlowField value={undefined} onChange={vi.fn()} />);
        expect(screen.getByText('No mix flow. The show picks as it always has.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Draw a mix flow' })).toBeInTheDocument();
    });

    it('counts the nodes of a flow, and removing it sends one with none', async () => {
        const onChange = vi.fn();
        render(<MixFlowField value={flow} onChange={onChange} />);
        expect(screen.getByText('A mix flow of 3 nodes.')).toBeInTheDocument();

        await setupUser().click(screen.getByRole('button', { name: 'Remove it' }));
        expect(onChange).toHaveBeenCalledWith({ version: 1, nodes: [], links: [] });
    });

    it('opens the canvas on the flow, and hands it back unchanged when used as it is', async () => {
        const onChange = vi.fn();
        const user = setupUser();
        render(<MixFlowField value={flow} onChange={onChange} showName="Church" />);

        await user.click(screen.getByRole('button', { name: 'Edit the mix flow' }));
        expect(await screen.findByText('Every record has a way to On air.')).toBeInTheDocument();
        expect(screen.getByText('Block bands')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Use this flow' }));
        expect(onChange).toHaveBeenCalledWith(flow);
    });
});
