// A `list` field's order is a decision an operator made — the feeds a bulletin reads in turn, the
// sites worth quoting — and until these controls existed the only way to change it was to delete
// every row below the one in the wrong place and type them again. What matters here is that a move
// carries the row's own VALUES with it, including ones typed and not yet saved, because a reorder
// that shuffled the cells independently would silently rewrite the list.

import { describe, expect, it, vi } from 'vitest';
import type { ConfigFieldDescriptor } from '@deadair/sdk';

import { ConfigFieldsForm } from '../../../src/components/settings/config.fields.form';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const FEEDS: ConfigFieldDescriptor = {
    key: 'feeds',
    label: 'Feeds',
    type: 'list',
    columns: [
        { key: 'name', label: 'Name', type: 'string' },
        { key: 'url', label: 'Address', type: 'url' },
    ],
};

const stored = (...rows: { name: string; url: string }[]): Record<string, unknown> => ({ feeds: JSON.stringify(rows) });

const ONE = { name: 'World', url: 'https://example.com/world.xml' };
const TWO = { name: 'Sport', url: 'https://example.com/sport.xml' };
const THREE = { name: 'Local', url: 'https://example.com/local.xml' };

/** The form as the settings page and the plugin page both mount it, with only what a list needs. */
function draw(values: Record<string, unknown>) {
    const onSubmit = vi.fn(async () => {});

    render(
        <ConfigFieldsForm
            fields={[FEEDS]}
            stored={values}
            secretsConfigured={{}}
            onSubmit={onSubmit}
            pending={false}
            succeeded={false}
            submitLabel="Save"
            failureTitle="It could not be saved"
            failureMessage="Nothing was written."
        />,
    );

    return { onSubmit, user: setupUser() };
}

/** What the form actually sent for the list, parsed back out of the string it is stored as. */
const submitted = (onSubmit: ReturnType<typeof vi.fn>): unknown => JSON.parse((onSubmit.mock.calls.at(-1)?.[0] as Record<string, string>).feeds!);

describe('reordering a list field', () => {
    it('moves a row up, values and all', async () => {
        const { onSubmit, user } = draw(stored(ONE, TWO, THREE));

        await user.click(screen.getByLabelText('Move row 2 up'));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalled());
        expect(submitted(onSubmit)).toEqual([TWO, ONE, THREE]);
    });

    it('moves a row down', async () => {
        const { onSubmit, user } = draw(stored(ONE, TWO, THREE));

        await user.click(screen.getByLabelText('Move row 1 down'));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalled());
        expect(submitted(onSubmit)).toEqual([TWO, ONE, THREE]);
    });

    // The ends are disabled rather than absent, so the remove control does not move sideways as a
    // list is reordered.
    it('cannot move the first row up or the last row down', async () => {
        draw(stored(ONE, TWO));

        expect(screen.getByLabelText('Move row 1 up')).toBeDisabled();
        expect(screen.getByLabelText('Move row 2 down')).toBeDisabled();
        expect(screen.getByLabelText('Move row 1 down')).toBeEnabled();
        expect(screen.getByLabelText('Move row 2 up')).toBeEnabled();
    });

    // The case a reorder implemented over its own state would get wrong: the typing has to travel
    // with the row rather than staying at the position it was entered at.
    it('carries typing that has not been saved yet', async () => {
        const { onSubmit, user } = draw(stored(ONE, TWO));

        const name = screen.getAllByRole('textbox')[2] as HTMLInputElement;
        await user.clear(name);
        await user.type(name, 'Sport desk');

        await user.click(screen.getByLabelText('Move row 2 up'));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalled());
        expect(submitted(onSubmit)).toEqual([{ ...TWO, name: 'Sport desk' }, ONE]);
    });
});
