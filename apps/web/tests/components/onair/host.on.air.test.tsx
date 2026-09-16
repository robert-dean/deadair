// The menu that changes who is presenting the show on air. It listed the whole roster, callers
// included, and picking one was not cosmetic: the binding took any persona that existed, so a
// caller presented the show and the breaks already written were rewritten in its character.

import type { Persona } from '@deadair/sdk';
import { describe, expect, it, vi } from 'vitest';

import { HostOnAir } from '../../../src/components/onair/host.on.air';
import { render, screen, setupUser } from '../../utils/render';

vi.mock('../../../src/api/client', () => ({
    sdk: {
        personas: { listPersonas: () => listPersonas() },
        director: { recastTheBroadcast: () => Promise.resolve({ items: [] }) },
    },
}));

const listPersonas = vi.fn();

const persona = (overrides: Partial<Persona> = {}): Persona => ({
    id: 'p-1',
    key: 'marlowe',
    kind: 'host',
    label: 'Marlowe',
    style: 'A late-night crime writer with a weakness for a good record.',
    defaultHost: false,
    presenting: false,
    ...overrides,
});

describe('HostOnAir', () => {
    it('offers the hosts and not the callers', async () => {
        listPersonas.mockResolvedValue({
            personas: [
                persona({ id: 'p-1', label: 'Deadpan wisecracking host', defaultHost: true, presenting: true }),
                persona({ id: 'p-2', key: 'valley', label: 'Valley girl (eighties)' }),
                persona({ id: 'p-3', key: 'proof', kind: 'caller', label: 'Caller who wants proof' }),
            ],
        });
        const user = setupUser();

        render(<HostOnAir />);
        await user.click(await screen.findByRole('button', { name: /Presented by/ }));

        expect(await screen.findByRole('menuitem', { name: 'Valley girl (eighties)' })).toBeInTheDocument();
        expect(screen.queryByRole('menuitem', { name: 'Caller who wants proof' })).not.toBeInTheDocument();
    });

    it('offers a persona whose kind the API did not state, because absent means host', async () => {
        // Every row predating callers answers with no `kind`, and a filter that read that as "not a
        // host" would empty this menu on any station that has not touched its roster since.
        listPersonas.mockResolvedValue({ personas: [{ ...persona({ label: 'Marlowe' }), kind: undefined }] });
        const user = setupUser();

        render(<HostOnAir />);
        await user.click(await screen.findByRole('button', { name: /Presented by/ }));

        expect(await screen.findByRole('menuitem', { name: 'Marlowe' })).toBeInTheDocument();
    });
});
