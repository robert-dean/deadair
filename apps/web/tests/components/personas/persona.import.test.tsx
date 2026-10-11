// A file from somebody else's station can carry a character with the same key as one of yours, and
// that is a coincidence of naming rather than a newer copy. What is pinned here is that the dialog
// never replaces one by default: a character already here is skipped until the operator chooses
// Replace on its row, and only the keys they chose are sent.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PersonaFile, PersonaImportEntry, PersonaImportPlan } from '@deadair/sdk';

import { PersonaImportModal } from '../../../src/components/personas/persona.import';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const previewPersonaImport = vi.fn();
const importPersonas = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        personas: {
            previewPersonaImport: (...args: unknown[]) => previewPersonaImport(...args),
            importPersonas: (...args: unknown[]) => importPersonas(...args),
        },
    },
}));

afterEach(() => {
    previewPersonaImport.mockReset();
    importPersonas.mockReset();
});

const FILE: PersonaFile = {
    format: 'deadair.persona/1',
    takenAt: '2026-10-11T00:00:00.000Z',
    personas: [
        { key: 'ozzysghost', label: "Ozzy's Ghost", style: 'a ghost', stories: [] },
        { key: 'newsreader', label: 'Walter', style: 'an anchor', stories: [] },
    ],
};

const entry = (over: Partial<PersonaImportEntry>): PersonaImportEntry => ({
    key: 'ozzysghost',
    label: "Ozzy's Ghost",
    outcome: 'create',
    storiesNew: 0,
    storiesHeld: 0,
    detailsNew: 0,
    detailsHeld: 0,
    notices: [],
    ...over,
});

const PLAN: PersonaImportPlan = {
    format: 'deadair.persona/1',
    notices: [],
    personas: [
        entry({}),
        entry({
            key: 'newsreader',
            label: 'Walter',
            outcome: 'skip',
            notices: [{ kind: 'clears', message: 'this file says nothing about its voice' }],
        }),
    ],
};

const choose = async (user: ReturnType<typeof setupUser>) => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File([JSON.stringify(FILE)], 'personas.json', { type: 'application/json' }));
};

describe('a character this station already holds', () => {
    it('is skipped by default, says so, and is not sent to be replaced', async () => {
        previewPersonaImport.mockResolvedValue(PLAN);
        importPersonas.mockResolvedValue({ plan: PLAN, created: 1, updated: 0, skipped: 1, storiesWritten: 0, detailsWritten: 0, personas: {} });
        const user = setupUser();

        render(<PersonaImportModal opened onClose={() => undefined} />);
        await choose(user);

        expect(await screen.findByText('1 of these is already here')).toBeInTheDocument();
        // What a replace would clear is not news while nothing is being replaced.
        expect(screen.queryByText(/says nothing about its voice/)).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Import 1 character' }));

        await waitFor(() => expect(importPersonas).toHaveBeenCalledTimes(1));
        // The second argument is the query: nothing named, so nothing already here is replaced.
        expect(importPersonas.mock.calls[0]?.[1]).toBeUndefined();
        expect(await screen.findByText(/1 character was already here and was left exactly as it was/)).toBeInTheDocument();
    });

    it('is sent to be replaced once the operator chooses Replace, with what that would cost shown', async () => {
        previewPersonaImport.mockResolvedValue(PLAN);
        importPersonas.mockResolvedValue({ plan: PLAN, created: 1, updated: 1, skipped: 0, storiesWritten: 0, detailsWritten: 0, personas: {} });
        const user = setupUser();

        render(<PersonaImportModal opened onClose={() => undefined} />);
        await choose(user);
        await screen.findByText('1 of these is already here');

        await user.click(screen.getByText('Replace'));

        expect(await screen.findByText(/says nothing about its voice/)).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Import 1, rewrite 1' }));

        await waitFor(() => expect(importPersonas).toHaveBeenCalledTimes(1));
        expect(importPersonas.mock.calls[0]?.[1]).toEqual({ replace: ['newsreader'] });
    });

    it('offers nothing to press when every character in the file is already here and skipped', async () => {
        previewPersonaImport.mockResolvedValue({ ...PLAN, personas: [PLAN.personas[1]!] });
        const user = setupUser();

        render(<PersonaImportModal opened onClose={() => undefined} />);
        await choose(user);

        expect(await screen.findByRole('button', { name: 'Nothing to import' })).toBeDisabled();
    });
});
