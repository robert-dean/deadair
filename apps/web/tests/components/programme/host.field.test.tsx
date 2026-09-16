// "Hosted by", drawn by the slot editor, the briefing box and the sustaining panel alike. A caller
// is cast into a production per beat and never presents, so it is not something a broadcast can be
// declared with.

import type { GetInputPropsReturnType } from '@mantine/form';
import type { Persona } from '@deadair/sdk';
import { describe, expect, it, vi } from 'vitest';

import { HostField } from '../../../src/components/programme/programme.fields';
import { render, screen, setupUser } from '../../utils/render';

vi.mock('../../../src/api/client', () => ({
    sdk: {
        personas: { listPersonas: () => listPersonas() },
        playlists: { listImportablePlaylists: () => Promise.resolve({ playlists: [] }) },
        charts: { listCharts: () => Promise.resolve({ charts: [] }) },
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

const input = (value: string): GetInputPropsReturnType => ({ value, onChange: vi.fn() }) as unknown as GetInputPropsReturnType;

describe('HostField', () => {
    it('offers the hosts and not the callers', async () => {
        listPersonas.mockResolvedValue({
            personas: [persona(), persona({ id: 'p-2', key: 'better', kind: 'caller', label: 'Caller who knows better' })],
        });
        const user = setupUser();

        render(<HostField {...input('')} />);
        await user.click(await screen.findByRole('combobox', { name: 'Hosted by' }));

        expect(await screen.findByRole('option', { name: 'Marlowe' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Caller who knows better' })).not.toBeInTheDocument();
    });
});
