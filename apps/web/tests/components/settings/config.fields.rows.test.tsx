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

// A table whose columns are not all about the same row: a provider reached at an address the
// operator runs, beside one reached where its vendor lives. What matters here is not only that the
// cell stops being drawn but that it stops being SENT — a stale address left behind by a change of
// kind is read straight into the plugin's network allowlist, so hiding it and storing it anyway
// would fix the half nobody was complaining about.
describe('a column that only some rows have', () => {
    const KINDED: ConfigFieldDescriptor = {
        key: 'providers',
        label: 'Providers',
        type: 'list',
        columns: [
            { key: 'name', label: 'Name', type: 'string' },
            {
                key: 'kind',
                label: 'Kind',
                type: 'select',
                options: [
                    { value: 'server', label: 'Server' },
                    { value: 'vendor', label: 'Vendor' },
                ],
            },
            { key: 'baseUrl', label: 'Address', type: 'url', dependsOn: 'kind', dependsOnValues: ['server'] },
        ],
    };

    function drawKinded(rows: Record<string, unknown>[]) {
        const onSubmit = vi.fn(async () => {});

        render(
            <ConfigFieldsForm
                fields={[KINDED]}
                stored={{ providers: JSON.stringify(rows) }}
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

    const sent = (onSubmit: ReturnType<typeof vi.fn>): Record<string, unknown>[] =>
        JSON.parse((onSubmit.mock.calls.at(-1)?.[0] as { providers: string }).providers);

    it('draws the cell on a row it applies to', () => {
        drawKinded([{ name: 'ollama', kind: 'server', baseUrl: 'http://localhost:11434/v1' }]);

        expect(screen.getByLabelText('Address')).toHaveValue('http://localhost:11434/v1');
    });

    it('draws a dash instead on a row it does not', () => {
        drawKinded([{ name: 'claude', kind: 'vendor' }]);

        expect(screen.queryByLabelText('Address')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Address does not apply to row 1')).toBeInTheDocument();
    });

    it('still draws the cell while the row is unclassified, which is every row just added', () => {
        // The load-bearing case. A column has no default, so a new row holds nothing in its Kind
        // cell, and a rule that hid the Address there would hide it on the one row most in need of
        // filling in.
        drawKinded([{ name: 'ollama' }]);

        expect(screen.getByLabelText('Address')).toBeInTheDocument();
    });

    it('tells one row from another rather than hiding a column outright', () => {
        drawKinded([
            { name: 'ollama', kind: 'server', baseUrl: 'http://localhost:11434/v1' },
            { name: 'claude', kind: 'vendor' },
        ]);

        expect(screen.getByLabelText('Address')).toHaveValue('http://localhost:11434/v1');
        expect(screen.getByLabelText('Address does not apply to row 2')).toBeInTheDocument();
        // The heading stays: the column belongs to the table, not to the row that happens to want it.
        expect(screen.getByRole('columnheader', { name: 'Address' })).toBeInTheDocument();
    });

    it('leaves a cell that does not apply out of the row it sends', async () => {
        // The point of the whole declaration. This row's address was typed before its kind was
        // changed, and the host reads the url column of every stored row into the allowlist.
        const { onSubmit, user } = drawKinded([{ $id: 'r1', name: 'claude', kind: 'vendor', baseUrl: 'http://stale.example.com/v1' }]);

        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalled());
        expect(sent(onSubmit)).toEqual([{ $id: 'r1', name: 'claude', kind: 'vendor' }]);
    });

    it('keeps sending the cells either side of a hidden one, which are addressed by position', async () => {
        // The trap this guards: a cell is named by its column's position, so filtering the columns
        // rather than asking per cell would write every later cell under its neighbour's key.
        const { onSubmit, user } = drawKinded([
            { $id: 'r1', name: 'claude', kind: 'vendor', baseUrl: 'http://stale.example.com/v1' },
            { $id: 'r2', name: 'ollama', kind: 'server', baseUrl: 'http://localhost:11434/v1' },
        ]);

        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalled());
        expect(sent(onSubmit)).toEqual([
            { $id: 'r1', name: 'claude', kind: 'vendor' },
            { $id: 'r2', name: 'ollama', kind: 'server', baseUrl: 'http://localhost:11434/v1' },
        ]);
    });

    it('shows the cell when the condition names a column the list does not declare', () => {
        // Forgiving for the reason the field-level rule is: a condition nobody can resolve should
        // not be the thing that hides a control.
        render(
            <ConfigFieldsForm
                fields={[
                    {
                        key: 'providers',
                        label: 'Providers',
                        type: 'list',
                        columns: [{ key: 'baseUrl', label: 'Address', type: 'url', dependsOn: 'kind', dependsOnValues: ['server'] }],
                    },
                ]}
                stored={{ providers: JSON.stringify([{ baseUrl: 'http://localhost:11434/v1' }]) }}
                secretsConfigured={{}}
                onSubmit={vi.fn(async () => {})}
                pending={false}
                succeeded={false}
                submitLabel="Save"
                failureTitle="It could not be saved"
                failureMessage="Nothing was written."
            />,
        );

        expect(screen.getByLabelText('Address')).toBeInTheDocument();
    });
});

// `table-layout: auto` sizes a column from what its cells CONTAIN, and a `secret` cell contains
// something different — the input plus its "Stored — clear it" link, in a Stack, whose min-content
// width is smaller than the bare wrapper every other cell holds. Measured on the llm plugin's
// providers table, that left Name, Kind and Address 358px each and the API key column 124, which
// truncated its own placeholder. Declared widths are what stop the browser guessing.
describe('a rows table apportions its columns', () => {
    const PROVIDERS: ConfigFieldDescriptor = {
        key: 'providers',
        label: 'Providers',
        type: 'list',
        columns: [
            { key: 'name', label: 'Name', type: 'string' },
            { key: 'kind', label: 'Kind', type: 'select', options: [{ value: 'server', label: 'Server' }] },
            { key: 'baseUrl', label: 'Address', type: 'url' },
            { key: 'apiKey', label: 'API key', type: 'secret' },
        ],
    };

    const drawn = (field: ConfigFieldDescriptor, rows: Record<string, unknown>[]) => {
        render(
            <ConfigFieldsForm
                fields={[field]}
                stored={{ [field.key]: JSON.stringify(rows) }}
                secretsConfigured={{}}
                onSubmit={vi.fn(async () => {})}
                pending={false}
                succeeded={false}
                submitLabel="Save"
                failureTitle="It could not be saved"
                failureMessage="Nothing was written."
            />,
        );

        return screen.getAllByRole('columnheader').map(th => th.style.width);
    };

    it('gives every column a declared width rather than letting the content decide', () => {
        const widths = drawn(PROVIDERS, [{ name: 'ollama' }]);

        // Four data columns plus the row controls, which keep their own fixed width.
        expect(widths).toHaveLength(5);
        expect(widths.slice(0, 4).every(width => width.endsWith('%'))).toBe(true);
    });

    it('gives the address more of the row than the cells either side of it', () => {
        const [name, kind, address, apiKey] = drawn(PROVIDERS, [{ name: 'ollama' }]).map(w => parseFloat(w));

        expect(address).toBeGreaterThan(name!);
        expect(address).toBeGreaterThan(kind!);
        expect(address).toBeGreaterThan(apiKey!);
        // The three that are not an address share equally: none of them holds a longer value than
        // the others, so a table that guessed between them would only ever guess wrong.
        expect(name).toBe(kind);
        expect(kind).toBe(apiKey);
    });

    it('fills the row whatever columns a list declares', () => {
        const two = drawn({ key: 'a', label: 'A', type: 'list', columns: PROVIDERS.columns!.slice(0, 2) }, [{}]);
        const total = two.slice(0, 2).reduce((sum, width) => sum + parseFloat(width), 0);

        expect(Math.round(total)).toBe(100);
    });
});
