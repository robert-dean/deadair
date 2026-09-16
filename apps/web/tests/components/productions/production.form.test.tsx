// Only one of the six boxes is required, and what is tested here is the difference between saying
// so and not: the form used to refuse a nameless production with a disabled button and a silent
// `return`, which is a form that will not submit and will not say why.

import type { Persona } from '@deadair/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductionForm } from '../../../src/components/productions/production.form';
import { render, screen, setupUser } from '../../utils/render';

vi.mock('../../../src/api/client', () => ({
    sdk: { personas: { listPersonas: () => listPersonas() } },
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

beforeEach(() => {
    // A station with no roster, which is what every case but the presenter one is about.
    listPersonas.mockResolvedValue({ personas: [] });
});

const build = () => {
    const onSubmit = vi.fn();
    render(<ProductionForm pending={false} error={undefined} onSubmit={onSubmit} onCancel={vi.fn()} />);
    return { onSubmit, user: setupUser() };
};

describe('ProductionForm', () => {
    it('says what is missing rather than refusing in silence', async () => {
        const { onSubmit, user } = build();

        await user.click(screen.getByRole('button', { name: 'Ask for it' }));

        expect(await screen.findByText('Give it a name')).toBeInTheDocument();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('asks for the production with the boxes that were filled in, and no others', async () => {
        const { onSubmit, user } = build();

        await user.type(screen.getByLabelText('Called', { exact: false }), 'The machine nobody wanted');
        await user.type(screen.getByLabelText('What it should be about'), 'The TR-808, and who rescued it.');
        await user.click(screen.getByRole('button', { name: 'Ask for it' }));

        // An empty box is a station default rather than an empty string sent as an answer: the
        // length, the mode and the presenter all have settings behind them.
        expect(onSubmit).toHaveBeenCalledWith({
            title: 'The machine nobody wanted',
            kind: 'podcast',
            brief: 'The TR-808, and who rescued it.',
        });
    });

    // "Presenter" is who PRESENTS the programme, and the callers it casts are chosen per beat by the
    // production itself. Offering one here read as though an operator could hand a show to somebody
    // phoning in to it.
    it('offers the hosts and not the callers as the presenter', async () => {
        listPersonas.mockResolvedValue({
            personas: [persona(), persona({ id: 'p-2', key: 'better', kind: 'caller', label: 'Caller who knows better' })],
        });
        const { user } = build();

        await user.click(await screen.findByRole('combobox', { name: 'Presenter' }));

        expect(await screen.findByRole('option', { name: 'Marlowe' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Caller who knows better' })).not.toBeInTheDocument();
    });

    it('submits on Enter, which is the shortcut a real form element buys', async () => {
        const { onSubmit, user } = build();

        await user.type(screen.getByLabelText('Called', { exact: false }), 'A short one{Enter}');

        expect(onSubmit).toHaveBeenCalledWith({ title: 'A short one', kind: 'podcast' });
    });
});
