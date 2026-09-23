// The editor's list boxes are one entry per line on screen and an array on the wire. What is worth
// holding still is that a field the station REFUSES scripts over reaches the save as written, since a
// line lost between the box and the API is a check that silently stops checking.

import { describe, expect, it, vi } from 'vitest';
import type { Persona, PersonaInput } from '@deadair/sdk';

import { PersonaEditor } from '../../../src/components/personas/persona.editor';
import { render, screen, setupUser } from '../../utils/render';

// The editor opens the voice list, the pad library and two mutations on mount. None of them is what
// this suite is about, so each answers as a station with nothing configured.
vi.mock('../../../src/api/personas.queries', () => ({
    useGeneratePersona: () => ({ mutate: vi.fn(), isPending: false }),
    useRehearsePersona: () => ({ mutate: vi.fn(), isPending: false, data: undefined, reset: vi.fn() }),
}));
vi.mock('../../../src/api/pads.queries', () => ({ usePads: () => ({ data: undefined, isLoading: false }) }));
vi.mock('../../../src/api/voices.queries', () => ({
    useVoices: () => ({ data: undefined, isLoading: false }),
    fetchVoiceSample: vi.fn(),
}));

const believer: Persona = {
    id: 'p-1',
    key: 'conspiracy',
    kind: 'host',
    label: 'Conspiracy host',
    style: 'a man who believes all of it',
    exclusiveSubjects: ['bigfoot, sasquatch', 'chemtrail, contrail'],
    defaultHost: false,
    presenting: false,
};

const open = (onSubmit: (draft: PersonaInput) => void) =>
    render(<PersonaEditor persona={believer} kind="host" opened onClose={() => {}} onSubmit={onSubmit} saving={false} />);

describe('PersonaEditor, the subjects kept apart', () => {
    it('shows one subject per line', async () => {
        open(() => {});

        expect(await screen.findByLabelText('Never in the same break')).toHaveValue('bigfoot, sasquatch\nchemtrail, contrail');
    });

    it('saves each line as one subject', async () => {
        const onSubmit = vi.fn();
        const user = setupUser();
        open(onSubmit);

        const box = await screen.findByLabelText('Never in the same break');
        await user.type(box, '\n  moon landing, soundstage  ');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit.mock.calls[0]![0].exclusiveSubjects).toEqual(['bigfoot, sasquatch', 'chemtrail, contrail', 'moon landing, soundstage']);
    });
});
