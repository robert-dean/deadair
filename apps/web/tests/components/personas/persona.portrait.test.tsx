// A presenter's picture on the character sheet: drawn when there is one, saved the moment one is
// dropped, and taken away with its own button.

import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { PersonaPortrait } from '../../../src/components/personas/persona.portrait';
import { render, screen, waitFor } from '../../utils/render';

const listPersonaPortraits = vi.fn();
const replacePersonaPortrait = vi.fn();
const removePersonaPortrait = vi.fn();

vi.mock('../../../src/api/client', () => ({
    BASE_URL: '/api',
    sdk: {
        art: {
            listPersonaPortraits: (...args: unknown[]) => listPersonaPortraits(...args),
            replacePersonaPortrait: (...args: unknown[]) => replacePersonaPortrait(...args),
            removePersonaPortrait: (...args: unknown[]) => removePersonaPortrait(...args),
        },
    },
}));

afterEach(() => {
    listPersonaPortraits.mockReset();
    replacePersonaPortrait.mockReset();
    removePersonaPortrait.mockReset();
});

const ID = '22222222-2222-4222-8222-222222222222';

describe('PersonaPortrait', () => {
    it('draws the picture the persona has, resolved against the API like a cover', async () => {
        listPersonaPortraits.mockResolvedValue({ portraits: [{ personaId: ID, url: 'art/aaaa/cover.png' }] });

        render(<PersonaPortrait personaId={ID} name="Sonny" />);

        expect(await screen.findByAltText('A picture of Sonny')).toHaveAttribute('src', '/api/art/aaaa/cover.png');
        expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    });

    it('offers to add one, and no Remove, for a persona with none', async () => {
        listPersonaPortraits.mockResolvedValue({ portraits: [] });

        render(<PersonaPortrait personaId={ID} name="Sonny" />);

        expect(await screen.findByText(/Drop a picture here/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    });

    it('takes the picture away for this persona', async () => {
        listPersonaPortraits.mockResolvedValue({ portraits: [{ personaId: ID, url: 'art/aaaa/cover.png' }] });
        removePersonaPortrait.mockResolvedValue({ portraits: [] });

        render(<PersonaPortrait personaId={ID} name="Sonny" />);
        await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));

        await waitFor(() => expect(removePersonaPortrait).toHaveBeenCalledWith(ID));
    });

    it('sends a dropped picture straight away', async () => {
        listPersonaPortraits.mockResolvedValue({ portraits: [] });
        replacePersonaPortrait.mockResolvedValue({ portraits: [{ personaId: ID, url: 'art/aaaa/cover.png' }] });

        const { container } = render(<PersonaPortrait personaId={ID} name="Sonny" />);
        await screen.findByText(/Drop a picture here/);
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'sonny.png', { type: 'image/png' }));

        await waitFor(() => expect(replacePersonaPortrait).toHaveBeenCalledWith(ID, expect.any(FormData)));
    });
});
