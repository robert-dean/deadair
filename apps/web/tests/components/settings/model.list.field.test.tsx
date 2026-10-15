// A model setting is an ordered list now: the first model that answers is used, and one that fails
// before answering hands the call to the next. What matters here is that the list box is chosen from
// rather than typed into (Add offers every model not already listed), that its order is the operator's
// and survives a save, and that an empty list says what it means rather than looking broken.

import { describe, expect, it, vi } from 'vitest';
import type { ConfigFieldDescriptor } from '@deadair/sdk';

import { ConfigFieldsForm } from '../../../src/components/settings/config.fields.form';
import { render, screen, setupUser, waitFor, within } from '../../utils/render';

const BREAK_MODELS: ConfigFieldDescriptor = {
    key: 'llm.breakModel',
    label: 'Models for a talk break',
    type: 'list',
    columns: [{ key: 'model', label: 'Model', type: 'select', required: true, optionsFrom: 'llm.models' }],
};

const MODELS = [
    { value: 'local:qwen', label: 'qwen · local' },
    { value: 'cloud:sonnet', label: 'sonnet · cloud' },
    { value: 'cloud:haiku', label: 'haiku · cloud' },
];

const stored = (...models: string[]): Record<string, unknown> => ({
    'llm.breakModel': models.length === 0 ? '' : JSON.stringify(models.map(model => ({ model }))),
});

function draw(values: Record<string, unknown>, derived?: Record<string, string>) {
    const onSubmit = vi.fn(async () => {});

    render(
        <ConfigFieldsForm
            fields={[BREAK_MODELS]}
            stored={values}
            secretsConfigured={{}}
            onSubmit={onSubmit}
            pending={false}
            succeeded={false}
            submitLabel="Save"
            failureTitle="It could not be saved"
            failureMessage="Nothing was written."
            suggestions={{ 'llm.breakModel.model': MODELS }}
            {...(derived === undefined ? {} : { derived })}
        />,
    );

    return { onSubmit, user: setupUser() };
}

/** The models the form sent, in order. */
const submitted = (onSubmit: ReturnType<typeof vi.fn>): string[] =>
    (JSON.parse((onSubmit.mock.calls.at(-1)?.[0] as Record<string, string>)['llm.breakModel']!) as { model: string }[]).map(row => row.model);

describe('a list of models', () => {
    it('shows each model by its name, in the order it is tried', () => {
        draw(stored('cloud:sonnet', 'local:qwen'));

        const rows = screen.getAllByRole('row');
        expect(within(rows[0]!).getByText('sonnet · cloud')).toBeInTheDocument();
        expect(within(rows[1]!).getByText('qwen · local')).toBeInTheDocument();
    });

    it('offers every model not already on the list, and adds the one picked to the end', async () => {
        const { onSubmit, user } = draw(stored('local:qwen'));

        await user.click(screen.getByPlaceholderText('Pick a model, or type provider:model'));
        const options = await screen.findAllByRole('option');
        expect(options.map(option => option.textContent)).toEqual(['sonnet · cloud', 'haiku · cloud']);

        await user.click(screen.getByRole('option', { name: 'haiku · cloud' }));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalled());
        expect(submitted(onSubmit)).toEqual(['local:qwen', 'cloud:haiku']);
    });

    it('takes a model typed by hand, for one a proxy does not list', async () => {
        const { onSubmit, user } = draw(stored());

        await user.type(screen.getByPlaceholderText('Pick a model, or type provider:model'), 'proxy:private-model');
        await user.click(screen.getByRole('button', { name: 'Add' }));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalled());
        expect(submitted(onSubmit)).toEqual(['proxy:private-model']);
    });

    it('moves a model up the order', async () => {
        const { onSubmit, user } = draw(stored('local:qwen', 'cloud:sonnet'));

        await user.click(screen.getByLabelText('Move sonnet · cloud up'));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalled());
        expect(submitted(onSubmit)).toEqual(['cloud:sonnet', 'local:qwen']);
    });

    it('removes a model', async () => {
        const { onSubmit, user } = draw(stored('local:qwen', 'cloud:sonnet'));

        await user.click(screen.getByLabelText('Remove qwen · local'));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalled());
        expect(submitted(onSubmit)).toEqual(['cloud:sonnet']);
    });

    it('says an empty list means the default model, and names it when the station knows it', () => {
        draw(stored(), { 'llm.breakModel': 'cloud:sonnet' });

        expect(screen.getByText('None listed, so the station asks the default model, sonnet · cloud.')).toBeInTheDocument();
    });
});
