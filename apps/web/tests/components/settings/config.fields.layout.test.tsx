// The form lays each field out as one row, label and help on the left and the control on the
// right, through the inputs' own `classNames` rather than a wrapper of its own. What is pinned here
// is which fields get the row and which keep their label above them, and that only a form that asks
// for it trades its Save button for the bar that appears once something is unsaved.

import { describe, expect, it, vi } from 'vitest';
import type { ConfigFieldDescriptor } from '@deadair/sdk';

import { ConfigFieldsForm, type ConfigFieldsFormProps } from '../../../src/components/settings/config.fields.form';
import { fieldRowClassNames } from '../../../src/components/settings/config.field.row';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const NAME: ConfigFieldDescriptor = { key: 'stream.title', label: 'Station name', type: 'string', default: '', help: 'What listeners see.' };
const MODELS: ConfigFieldDescriptor = {
    key: 'llm.models',
    label: 'Models',
    type: 'multiselect',
    default: '',
    options: [{ value: 'a', label: 'A' }],
};

function draw(props: Partial<ConfigFieldsFormProps> = {}) {
    const onSubmit = vi.fn(async () => {});
    render(
        <ConfigFieldsForm
            fields={[NAME, MODELS]}
            stored={{ 'stream.title': 'Old FM' }}
            secretsConfigured={{}}
            onSubmit={onSubmit}
            pending={false}
            succeeded={false}
            submitLabel="Save"
            failureTitle="It could not be saved"
            failureMessage="Nothing was written."
            {...props}
        />,
    );
    return { user: setupUser(), onSubmit };
}

/** The input wrapper's root, which is where the row class lands. */
function rootOf(label: string): HTMLElement {
    const root = screen.getByText(label).closest('.mantine-InputWrapper-root');
    if (root === null) throw new Error(`no wrapper for ${label}`);
    return root as HTMLElement;
}

describe('the settings row', () => {
    it('lays a one-control field out as a row', () => {
        draw();

        expect(rootOf('Station name')).toHaveClass(String(fieldRowClassNames.root));
        expect(screen.getByText('What listeners see.')).toHaveClass(String(fieldRowClassNames.description));
    });

    it('keeps the label above a field wider than the control column', () => {
        draw();

        expect(rootOf('Models')).not.toHaveClass(String(fieldRowClassNames.root));
    });
});

describe('the save bar', () => {
    it('keeps an always-present Save for a form that does not ask for the bar', () => {
        // A plugin is often saved with its defaults untouched just to set it up, and a new topic's
        // name is typed outside the form; both need a Save before anything in here has changed.
        draw();

        expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();
    });

    it('shows the bar only while something is unsaved, and saves from it', async () => {
        const { user, onSubmit } = draw({ saveBar: true });

        expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();

        await user.type(screen.getByLabelText('Station name'), '!');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => {
            expect(onSubmit).toHaveBeenCalledTimes(1);
        });
        await waitFor(() => {
            expect(screen.queryByRole('region', { name: 'Unsaved changes' })).not.toBeInTheDocument();
        });
    });

    it('discards back to what was last saved, not to what the form was first drawn with', async () => {
        const { user } = draw({ saveBar: true });
        const input = screen.getByLabelText('Station name');

        await user.type(input, '!');
        await user.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => {
            expect(screen.queryByRole('region', { name: 'Unsaved changes' })).not.toBeInTheDocument();
        });

        await user.type(input, '?');
        await user.click(screen.getByRole('button', { name: 'Discard' }));

        expect(input).toHaveValue('Old FM!');
    });
});
