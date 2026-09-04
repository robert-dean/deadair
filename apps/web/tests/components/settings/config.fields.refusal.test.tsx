// A refused save has to be VISIBLE, and for a while it was not. The API answers a plugin schema's
// refusal with a 422 whose `details` carried only its own sentence; this form read `details` as a
// field map, found nothing it recognised, and suppressed its own alert on the grounds that the
// fields had already been told. So an operator saving a provider without the key it needs got
// nothing at all — no alert, no field message, no change — on the one screen the refusal exists to
// reach them on.

import { describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';
import type { ConfigFieldDescriptor } from '@deadair/sdk';

import { ConfigFieldsForm } from '../../../src/components/settings/config.fields.form';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const FIELDS: ConfigFieldDescriptor[] = [
    { key: 'providerKind', label: 'Provider', type: 'string' },
    { key: 'apiKey', label: 'API key', type: 'secret' },
];

/** A 422 in the shape the API actually sends one. */
const refusal = (details: Record<string, string>) =>
    new SdkError(422, 'Unprocessable Entity', { statusCode: 422, message: 'Unprocessable Entity', details }, new Headers());

function draw(error: unknown) {
    render(
        <ConfigFieldsForm
            fields={FIELDS}
            stored={{ providerKind: 'anthropic' }}
            secretsConfigured={{ apiKey: false }}
            onSubmit={vi.fn(async () => {})}
            pending={false}
            succeeded={false}
            error={error}
            submitLabel="Save configuration"
            failureTitle="Save failed"
            failureMessage="The configuration could not be saved."
        />,
    );
}

describe('a save the server refused', () => {
    it('says so out loud when the refusal names no field this form is drawing', async () => {
        draw(refusal({ message: 'configuration is invalid: (root): pick a provider first' }));

        expect(await screen.findByText(/pick a provider first/)).toBeInTheDocument();
    });

    it('stays quiet in the banner when a field took the message instead', async () => {
        // Not silence: the input itself carries it, and repeating it above the form would be the
        // same sentence twice on a form the operator is looking straight at.
        draw(refusal({ apiKey: 'This provider needs an API key', message: 'configuration is invalid: apiKey: This provider needs an API key' }));

        expect(screen.queryByText('Save failed')).not.toBeInTheDocument();
    });

    it('reports anything that is not a field refusal at all', async () => {
        draw(new SdkError(500, 'Internal Server Error', { statusCode: 500, message: 'Internal Server Error' }, new Headers()));

        expect(await screen.findByText('Save failed')).toBeInTheDocument();
    });

    it('falls back to its own wording when the failure carries none', async () => {
        draw(new SdkError(500, 'Internal Server Error', {}, new Headers()));

        expect(await screen.findByText('The configuration could not be saved.')).toBeInTheDocument();
    });

    it('puts the server field message on the input it names', async () => {
        const user = setupUser();
        const onSubmit = vi.fn(async () => {
            throw refusal({ apiKey: 'This provider needs an API key', message: 'configuration is invalid: apiKey: This provider needs an API key' });
        });

        render(
            <ConfigFieldsForm
                fields={FIELDS}
                stored={{ providerKind: 'anthropic' }}
                secretsConfigured={{ apiKey: false }}
                onSubmit={onSubmit}
                pending={false}
                succeeded={false}
                submitLabel="Save configuration"
                failureTitle="Save failed"
                failureMessage="The configuration could not be saved."
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Save configuration' }));

        await waitFor(() => expect(screen.getByText('This provider needs an API key')).toBeInTheDocument());
    });
});
