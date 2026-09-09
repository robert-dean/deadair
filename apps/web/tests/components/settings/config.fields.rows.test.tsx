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
const submitted = (onSubmit: ReturnType<typeof vi.fn>): unknown => JSON.parse((onSubmit.mock.calls.at(-1)?.[0] as { feeds: string }).feeds);

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

describe('a credential inside a row', () => {
    const PROVIDERS: ConfigFieldDescriptor = {
        key: 'providers',
        label: 'Providers',
        type: 'list',
        columns: [
            { key: 'name', label: 'Name', type: 'string' },
            { key: 'apiKey', label: 'API key', type: 'secret' },
        ],
    };

    /** A stored row, as the server sends one: an id, the ordinary cells, and never the credential. */
    const provider = (values: Record<string, unknown>) => ({ providers: JSON.stringify([values]) });

    function drawProviders(stored: Record<string, unknown>, secretsConfigured: Record<string, boolean> = {}) {
        const onSubmit = vi.fn(async () => {});

        render(
            <ConfigFieldsForm
                fields={[PROVIDERS]}
                stored={stored}
                secretsConfigured={secretsConfigured}
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

    /** Every row the form actually sent, parsed back out of the string the list is stored as. */
    const sentRows = (onSubmit: ReturnType<typeof vi.fn>): Record<string, unknown>[] =>
        JSON.parse((onSubmit.mock.calls.at(-1)?.[0] as { providers: string }).providers);

    /** The single row the form actually sent. */
    const sentRow = (onSubmit: ReturnType<typeof vi.fn>): Record<string, unknown> => sentRows(onSubmit)[0]!;

    const saveButton = () => screen.getByRole('button', { name: 'Save' });

    it('draws the cell empty with a stored value behind it', async () => {
        // Write-only, exactly as a secret FIELD is: the API reports one as a boolean and no more, so
        // there is never a value to draw.
        const { user } = drawProviders(provider({ $id: 'r1', name: 'claude' }), { 'providers/r1/apiKey': true });

        expect(screen.getByLabelText('API key')).toHaveValue('');
        expect(screen.getByLabelText('API key')).toHaveAttribute('placeholder', '••••••••');
        expect(screen.getByRole('button', { name: 'Clear the stored api key' })).toBeInTheDocument();
        await user.click(saveButton());
    });

    it('leaves an untouched credential out of the row it sends', async () => {
        // Which is what lets an operator rename a provider without retyping the key beside it.
        const { onSubmit, user } = drawProviders(provider({ $id: 'r1', name: 'claude' }), { 'providers/r1/apiKey': true });

        await user.clear(screen.getByLabelText('Name'));
        await user.type(screen.getByLabelText('Name'), 'renamed');
        await user.click(saveButton());

        expect(sentRow(onSubmit)).toEqual({ $id: 'r1', name: 'renamed' });
    });

    it('sends a credential the operator typed', async () => {
        const { onSubmit, user } = drawProviders(provider({ $id: 'r1', name: 'claude' }));

        await user.type(screen.getByLabelText('API key'), 'sk-live');
        await user.click(saveButton());

        expect(sentRow(onSubmit)).toEqual({ $id: 'r1', name: 'claude', apiKey: 'sk-live' });
    });

    it('sends null for a credential the operator cleared', async () => {
        // null, not '': the key has to be present for the server to read it as a clear, and an empty
        // string is what a half-typed cell looks like.
        const { onSubmit, user } = drawProviders(provider({ $id: 'r1', name: 'claude' }), { 'providers/r1/apiKey': true });

        await user.click(screen.getByRole('button', { name: 'Clear the stored api key' }));
        await user.click(saveButton());

        expect(sentRow(onSubmit)).toEqual({ $id: 'r1', name: 'claude', apiKey: null });
    });

    it('offers nothing to clear on a row the server has never seen', async () => {
        // A new row has no id, so nothing can be stored against it and there is nothing to describe.
        const { onSubmit, user } = drawProviders({ providers: '[]' });

        await user.click(screen.getByRole('button', { name: 'Add' }));
        await user.type(screen.getByLabelText('Name'), 'fresh');
        await user.type(screen.getByLabelText('API key'), 'sk-new');

        expect(screen.queryByRole('button', { name: /Clear the stored/ })).not.toBeInTheDocument();

        await user.click(saveButton());
        expect(sentRow(onSubmit)).toEqual({ name: 'fresh', apiKey: 'sk-new' });
    });

    it('carries the row id through a reorder, so a credential stays with its row', async () => {
        // The whole reason a row has an id: position is not identity once the operator can drag.
        const onSubmit = vi.fn(async () => {});
        render(
            <ConfigFieldsForm
                fields={[PROVIDERS]}
                stored={{
                    providers: JSON.stringify([
                        { $id: 'first', name: 'a' },
                        { $id: 'second', name: 'b' },
                    ]),
                }}
                secretsConfigured={{}}
                onSubmit={onSubmit}
                pending={false}
                succeeded={false}
                submitLabel="Save"
                failureTitle="It could not be saved"
                failureMessage="Nothing was written."
            />,
        );
        const user = setupUser();

        await user.click(screen.getByRole('button', { name: 'Move row 2 up' }));
        await user.click(saveButton());

        expect(sentRows(onSubmit)).toEqual([
            { $id: 'second', name: 'b' },
            { $id: 'first', name: 'a' },
        ]);
    });
});
