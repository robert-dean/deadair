import { describe, expect, it, vi } from 'vitest';
import type { Pad } from '@deadair/sdk';

import { PadUseModal, PadUseSummary } from '../../../src/components/pads/pad.use.modal';
import { render, screen, setupUser } from '../../utils/render';

const pad = (overrides: Partial<Pad> = {}): Pad =>
    ({
        id: 'pad-1',
        board: 'rockzo',
        sets: ['rockzo'],
        name: 'guitarriff',
        label: 'Guitar riff',
        source: 'upload',
        state: 'active',
        placements: ['start', 'middle', 'end'],
        ...overrides,
    }) as Pad;

describe('PadUseSummary', () => {
    it('says nothing for a pad left at the default, so an untouched rack reads as it always did', () => {
        const { container } = render(<PadUseSummary pad={pad()} />);

        // The render helper's MantineProvider writes its CSS variables into the container, so it is
        // never empty; what must be absent is the line itself.
        expect(container.querySelector('.mantine-Text-root')).toBeNull();
    });

    it('says where a sound is kept, and its cue in quotes', () => {
        render(<PadUseSummary pad={pad({ placements: ['middle'] })} />);
        expect(screen.getByText('Only between words')).toBeInTheDocument();
    });

    it('says the cue and the placement together when both are set', () => {
        render(<PadUseSummary pad={pad({ placements: ['start', 'middle'], cue: 'right after a punchline' })} />);
        expect(screen.getByText('“right after a punchline” · Never after the words')).toBeInTheDocument();
    });
});

describe('PadUseModal', () => {
    it('opens on what the pad has now', () => {
        render(<PadUseModal pad={pad({ placements: ['middle'], cue: 'when something fails' })} onClose={vi.fn()} onSave={vi.fn()} />);

        expect(screen.getByRole('checkbox', { name: 'Before the words' })).not.toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Between words' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'After the words' })).not.toBeChecked();
        expect(screen.getByRole('textbox', { name: /When to reach for it/ })).toHaveValue('when something fails');
    });

    it('saves the boxes in break order and the cue trimmed, then closes', async () => {
        const onSave = vi.fn(async () => undefined);
        const onClose = vi.fn();
        const user = setupUser();
        render(<PadUseModal pad={pad()} onClose={onClose} onSave={onSave} />);

        await user.click(screen.getByRole('checkbox', { name: 'Before the words' }));
        await user.click(screen.getByRole('checkbox', { name: 'After the words' }));
        await user.type(screen.getByRole('textbox', { name: /When to reach for it/ }), '  right after a punchline ');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSave).toHaveBeenCalledWith({ placements: ['middle'], cue: 'right after a punchline' });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('sends no cue when the box is left empty, which is how one is cleared', async () => {
        const onSave = vi.fn(async () => undefined);
        const user = setupUser();
        render(<PadUseModal pad={pad({ cue: 'old note' })} onClose={vi.fn()} onSave={onSave} />);

        await user.clear(screen.getByRole('textbox', { name: /When to reach for it/ }));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSave).toHaveBeenCalledWith({ placements: ['start', 'middle', 'end'] });
    });

    it('will not save a sound allowed nowhere, and says what to do instead', async () => {
        const user = setupUser();
        render(<PadUseModal pad={pad({ placements: ['middle'] })} onClose={vi.fn()} onSave={vi.fn()} />);

        await user.click(screen.getByRole('checkbox', { name: 'Between words' }));

        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
        expect(screen.getByText(/reject it instead/)).toBeInTheDocument();
    });

    it('stays open and shows why when the save fails', async () => {
        const onClose = vi.fn();
        const user = setupUser();
        render(<PadUseModal pad={pad()} onClose={onClose} onSave={vi.fn(async () => Promise.reject(new Error('nope')))} />);

        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText('That did not save')).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });
});
