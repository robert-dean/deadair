// A card used to draw six equal-weight buttons — Put on air, Rehearse, Notebook, Stories, Edit,
// Delete — which put Delete at the same visual weight as the one action anybody comes to this page
// for. What is worth testing here is the shape that replaced it: three actions in hand and the rest
// behind a menu, and that the card still reads on a phone once it wraps.

import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Persona } from '@deadair/sdk';

import { PersonasPage } from '../../../src/components/personas/personas.page';
import { render, screen, setupUser } from '../../utils/render';
import { stubPhoneMedia } from '../../utils/phone';

// This page opens four queries on mount (personas, voices, script summary). Everything but the
// persona list itself is covered by its own suite; here it only has to not throw.
vi.mock('../../../src/api/client', () => ({
    sdk: {
        personas: { listPersonas: () => listPersonas() },
        render: { listVoices: () => Promise.resolve({ voices: [] }), readScriptSummary: () => Promise.resolve({ rows: [] }) },
        settings: { getSettings: () => Promise.resolve({ descriptors: [], values: {}, configured: {} }) },
    },
}));

vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
        <a href={to} {...rest}>
            {children}
        </a>
    ),
}));

const listPersonas = vi.fn();

const persona = (overrides: Partial<Persona> = {}): Persona => ({
    id: 'p-1',
    key: 'marlowe',
    kind: 'host',
    label: 'Marlowe',
    style: 'A late-night crime writer with a weakness for a good record.',
    active: false,
    ...overrides,
});

describe('PersonasPage', () => {
    it('keeps three actions in hand on a host card, and Delete is not one of them', async () => {
        listPersonas.mockResolvedValue({ personas: [persona()] });
        render(<PersonasPage />);

        expect(await screen.findByRole('button', { name: 'Put on air' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Rehearse' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
        // Delete carried the same weight as Put on air; it now lives behind the menu and is not on
        // the card until that menu is opened.
        expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    });

    it('reveals Notebook, Stories, Export and Delete once the menu is opened', async () => {
        listPersonas.mockResolvedValue({ personas: [persona()] });
        const user = setupUser();
        render(<PersonasPage />);

        await user.click(await screen.findByRole('button', { name: 'More about Marlowe' }));

        expect(screen.getByRole('menuitem', { name: 'Notebook' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Stories' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Export' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    });

    it('never offers Put on air for a caller, who can never present', async () => {
        listPersonas.mockResolvedValue({ personas: [persona({ id: 'p-2', key: 'ringer', kind: 'caller', label: 'Ringer' })] });
        render(<PersonasPage />);

        await screen.findByText('Ringer');
        expect(screen.queryByRole('button', { name: 'Put on air' })).not.toBeInTheDocument();
    });

    it('never offers Put on air for the persona already on air, since it is already there', async () => {
        listPersonas.mockResolvedValue({ personas: [persona({ active: true })] });
        render(<PersonasPage />);

        await screen.findByText('Marlowe');
        expect(screen.queryByRole('button', { name: 'Put on air' })).not.toBeInTheDocument();
    });

    it('still renders a name, a description and the three actions on a phone', async () => {
        // Below 500px the action row used to hold its intrinsic width while the left column
        // collapsed toward zero, printing the buttons over the persona's name.
        const restore = stubPhoneMedia();
        try {
            listPersonas.mockResolvedValue({ personas: [persona()] });
            render(<PersonasPage />);

            expect(await screen.findByText('Marlowe')).toBeInTheDocument();
            expect(screen.getByText('A late-night crime writer with a weakness for a good record.')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Put on air' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Rehearse' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
        } finally {
            restore();
        }
    });
});
