// A show's own sound. What is pinned: choosing a recording for a show adds the show to THAT
// recording's scope and keeps whatever else it was scoped to, taking it away removes only this show,
// and a recording that plays on every show says so before it is chosen.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Segment } from '@deadair/sdk';

import { ShowSoundField } from '../../../src/components/schedule/show.sound.field';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const listSegments = vi.fn();
const scopeSegment = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        render: {
            listSegments: (...args: unknown[]) => listSegments(...args),
            scopeSegment: (...args: unknown[]) => scopeSegment(...args),
        },
    },
}));

afterEach(() => {
    vi.resetAllMocks();
});

const recording = (over: Partial<Segment>): Segment => ({
    id: 'r',
    kind: 'bed',
    state: 'ready',
    label: 'A bed',
    source: 'library',
    playable: true,
    ...over,
});

const beds = { checked: true, onChange: () => {} } as never;

describe('ShowSoundField', () => {
    it('asks for the show to be saved before it can have recordings of its own', () => {
        render(<ShowSoundField slotId={undefined} beds={beds} />);

        expect(screen.getByText(/Save the show first/)).toBeInTheDocument();
        expect(listSegments).not.toHaveBeenCalled();
    });

    it("shows which of the library's recordings are this show's", async () => {
        listSegments.mockResolvedValue({
            segments: [
                recording({ id: 'b-mine', label: 'Late bed', slotIds: ['slot-1'] }),
                recording({ id: 'b-all', label: 'House bed' }),
                recording({ id: 'j-1', kind: 'jingle', label: 'Late jingle', slotIds: ['slot-1'] }),
                recording({ id: 'talk', kind: 'talkbreak', source: 'render', label: 'A link' }),
            ],
        });

        render(<ShowSoundField slotId="slot-1" beds={beds} />);

        // A chosen recording is drawn as a pill in its picker.
        expect((await screen.findAllByText('Late bed')).length).toBeGreaterThan(0);
        expect(screen.getAllByText('Late jingle').length).toBeGreaterThan(0);
        expect(screen.queryByText('A link')).not.toBeInTheDocument();
    });

    it("adds this show to a recording's scope, keeping the shows and presenters it already had", async () => {
        listSegments.mockResolvedValue({
            segments: [recording({ id: 'b-other', label: 'Breakfast bed', slotIds: ['slot-2'], personaIds: ['p-1'] })],
        });
        scopeSegment.mockImplementation(async (id: string, scope: { slotIds: string[]; personaIds: string[] }) => recording({ id, ...scope }));
        const user = setupUser();

        render(<ShowSoundField slotId="slot-1" beds={beds} />);

        const picker = await screen.findByRole('combobox', { name: 'Music beds' });
        // Disabled until the library has answered, since an empty picker offers nothing.
        await waitFor(() => expect(picker).not.toBeDisabled());
        await user.click(picker);
        await user.click(await screen.findByRole('option', { name: 'Breakfast bed' }));

        await waitFor(() => expect(scopeSegment).toHaveBeenCalledWith('b-other', { slotIds: ['slot-2', 'slot-1'], personaIds: ['p-1'] }));
    });

    it('marks a recording that plays on every show before it is chosen', async () => {
        listSegments.mockResolvedValue({ segments: [recording({ id: 'b-all', label: 'House bed' })] });
        const user = setupUser();

        render(<ShowSoundField slotId="slot-1" beds={beds} />);

        const picker = await screen.findByRole('combobox', { name: 'Music beds' });
        // Disabled until the library has answered, since an empty picker offers nothing.
        await waitFor(() => expect(picker).not.toBeDisabled());
        await user.click(picker);
        expect(await screen.findByRole('option', { name: 'House bed (every show)' })).toBeInTheDocument();
    });
});
