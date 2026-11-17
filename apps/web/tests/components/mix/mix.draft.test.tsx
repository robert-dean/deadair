// Drafting a show's mix flow from its brief: the button on the field and on the canvas, the readings
// beside the canvas, and answering what the model asked, which drafts again with the answers.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SdkError, type MixFlow, type MixFlowDraft } from '@deadair/sdk';

import { MixFlowField } from '../../../src/components/mix/mix.flow.field';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const draftMixFlow = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: { schedule: { draftMixFlow: (body: unknown) => draftMixFlow(body) } },
}));

const BRIEF = 'Black metal only now and then. No Burzum.';

const drafted: MixFlowDraft = {
    flow: {
        version: 1,
        nodes: [
            { id: 'picks', kind: 'picks', x: 0, y: 0 },
            { id: 'block-1', kind: 'block', bands: ['Burzum'], fromBrief: 'No Burzum.', x: 320, y: 0 },
            { id: 'air', kind: 'onAir', x: 640, y: 0 },
        ],
        links: [
            { from: 'picks', out: 0, to: 'block-1', in: 0 },
            { from: 'block-1', out: 0, to: 'air', in: 0 },
        ],
    },
    readings: [
        { quote: 'No Burzum.', note: 'Burzum never plays.', nodeIds: ['block-1'] },
        { quote: 'candlelit', note: 'Left to the picks.' },
        {
            quote: 'only now and then',
            note: 'Unclear, so the draft made its best guess.',
            question: 'How rare is rare?',
            options: ['A tenth an hour', 'One a show'],
        },
    ],
    model: 'ollama:gemma4',
};

const drawn: MixFlow = {
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

beforeEach(() => {
    draftMixFlow.mockReset();
    draftMixFlow.mockResolvedValue(drafted);
});

describe('drafting a mix flow from the brief', () => {
    it('is offered on the field only for a show with a brief and no flow', () => {
        const { unmount } = render(<MixFlowField value={undefined} onChange={vi.fn()} brief={BRIEF} />);
        expect(screen.getByRole('button', { name: 'Draft from the brief' })).toBeInTheDocument();
        unmount();

        render(<MixFlowField value={undefined} onChange={vi.fn()} brief="  " />);
        expect(screen.queryByRole('button', { name: 'Draft from the brief' })).not.toBeInTheDocument();
    });

    it('drafts as the canvas opens, draws the flow with its phrases, and lists what it read', async () => {
        const onChange = vi.fn();
        const user = setupUser();
        render(<MixFlowField value={undefined} onChange={onChange} brief={BRIEF} />);

        await user.click(screen.getByRole('button', { name: 'Draft from the brief' }));
        expect(await screen.findByText('Burzum never plays.')).toBeInTheDocument();
        expect(draftMixFlow).toHaveBeenCalledWith({ brief: BRIEF });

        expect(screen.getByText('Block bands')).toBeInTheDocument();
        expect(screen.getAllByText('“No Burzum.”').length).toBeGreaterThanOrEqual(2);
        expect(screen.getByText('Left to the picks.')).toBeInTheDocument();
        expect(screen.getByText('Drafted by ollama:gemma4.')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Use this flow' }));
        expect(onChange).toHaveBeenCalledWith(drafted.flow);
    });

    it('drafts again with the answers the operator chose', async () => {
        const user = setupUser();
        render(<MixFlowField value={undefined} onChange={vi.fn()} brief={BRIEF} />);
        await user.click(screen.getByRole('button', { name: 'Draft from the brief' }));
        expect(await screen.findByText('How rare is rare?')).toBeInTheDocument();

        const again = screen.getByRole('button', { name: 'Draft again with these answers' });
        expect(again).toBeDisabled();
        await user.click(screen.getByText('One a show'));
        await user.click(again);

        await waitFor(() =>
            expect(draftMixFlow).toHaveBeenLastCalledWith({ brief: BRIEF, answers: [{ question: 'How rare is rare?', answer: 'One a show' }] }),
        );
    });

    it('asks before a draft replaces what is drawn', async () => {
        const user = setupUser();
        render(<MixFlowField value={drawn} onChange={vi.fn()} brief={BRIEF} />);
        await user.click(screen.getByRole('button', { name: 'Edit the mix flow' }));

        await user.click(await screen.findByRole('button', { name: 'Draft from the brief' }));
        expect(draftMixFlow).not.toHaveBeenCalled();
        await user.click(await screen.findByRole('button', { name: 'Replace it' }));
        expect(await screen.findByText('Burzum never plays.')).toBeInTheDocument();
        expect(draftMixFlow).toHaveBeenCalledTimes(1);
    });

    it("shows the station's reason when a draft fails", async () => {
        draftMixFlow.mockRejectedValue(
            new SdkError(
                503,
                'Service Unavailable',
                { statusCode: 503, message: 'Service Unavailable', details: { message: 'The model was needed on air, so the draft stopped.' } },
                new Headers(),
            ),
        );
        const user = setupUser();
        render(<MixFlowField value={undefined} onChange={vi.fn()} brief={BRIEF} />);
        await user.click(screen.getByRole('button', { name: 'Draft from the brief' }));

        expect(await screen.findByText('The draft did not work.')).toBeInTheDocument();
        expect(screen.getByText(/needed on air/)).toBeInTheDocument();
    });
});
