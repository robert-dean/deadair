import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { SdkError } from '@deadair/sdk';
import type { ConfigFieldDescriptor } from '@deadair/sdk';

import { PluginConfigForm } from '../../../src/components/plugins/plugin.config.form';
import { pluginDetail } from '../../utils/plugin.fixture';
import { render, screen, waitFor } from '../../utils/render';

const updatePluginConfiguration = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        plugins: {
            updatePluginConfiguration: (...args: unknown[]) => updatePluginConfiguration(...args),
        },
    },
}));

afterEach(() => {
    updatePluginConfiguration.mockReset();
});

/** The config the form actually submitted, from the single PUT it made. */
function submittedConfig(): Record<string, unknown> {
    expect(updatePluginConfiguration).toHaveBeenCalledTimes(1);
    return (updatePluginConfiguration.mock.calls[0]?.[1] as { config: Record<string, unknown> }).config;
}

async function save() {
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save configuration' }));
}

const SECRET_FIELD: ConfigFieldDescriptor = { key: 'clientSecret', label: 'Client secret', type: 'secret', required: true };

describe('PluginConfigForm', () => {
    it('renders a control for every field type and no input for a note', () => {
        const plugin = pluginDetail({
            configFields: [
                { key: 'clientId', label: 'Client ID', type: 'string' },
                { key: 'redirectUri', label: 'Redirect URI', type: 'url' },
                SECRET_FIELD,
                { key: 'timeout', label: 'Timeout', type: 'number' },
                { key: 'preferLocal', label: 'Prefer local', type: 'boolean' },
                { key: 'market', label: 'Market', type: 'select', options: [{ value: 'gb', label: 'United Kingdom' }] },
                { key: 'notice', label: 'Notice', type: 'note', help: 'Register the app first.' },
            ],
        });

        render(<PluginConfigForm plugin={plugin} />);

        for (const label of ['Client ID', 'Redirect URI', 'Client secret', 'Timeout', 'Prefer local', 'Market']) {
            // getAll: a Mantine Select carries a hidden input under the same label as its combobox.
            expect(screen.getAllByLabelText(label, { exact: false }).length).toBeGreaterThan(0);
        }
        expect(screen.getByText('Register the app first.')).toBeInTheDocument();
        expect(screen.queryByLabelText('Notice')).not.toBeInTheDocument();
    });

    it('leaves a stored secret out of the submission when it is not retyped', async () => {
        const plugin = pluginDetail({
            configFields: [{ key: 'clientId', label: 'Client ID', type: 'string' }, SECRET_FIELD],
            config: { clientId: 'abc' },
            secretsConfigured: { clientSecret: true },
        });
        updatePluginConfiguration.mockResolvedValue(plugin);

        render(<PluginConfigForm plugin={plugin} />);

        expect(screen.getByLabelText('Client secret', { exact: false })).toHaveValue('');
        expect(screen.getByText(/leave blank to keep it/i)).toBeInTheDocument();

        await save();

        await waitFor(() => {
            expect(submittedConfig()).toEqual({ clientId: 'abc' });
        });
    });

    it('submits a secret the operator typed', async () => {
        const plugin = pluginDetail({ configFields: [SECRET_FIELD], secretsConfigured: { clientSecret: true } });
        updatePluginConfiguration.mockResolvedValue(plugin);

        render(<PluginConfigForm plugin={plugin} />);
        await userEvent.setup().type(screen.getByLabelText('Client secret', { exact: false }), 'hunter2');
        await save();

        await waitFor(() => {
            expect(submittedConfig()).toEqual({ clientSecret: 'hunter2' });
        });
    });

    it('submits null for a secret the operator cleared', async () => {
        const optionalSecret: ConfigFieldDescriptor = { key: 'apiKey', label: 'API key', type: 'secret' };
        const plugin = pluginDetail({ configFields: [optionalSecret], secretsConfigured: { apiKey: true } });
        updatePluginConfiguration.mockResolvedValue(plugin);

        render(<PluginConfigForm plugin={plugin} />);
        await userEvent.setup().click(screen.getByRole('button', { name: 'Clear the stored value' }));

        expect(screen.getByText('Will be removed when you save.')).toBeInTheDocument();

        await save();

        await waitFor(() => {
            // null, not '': the key has to be present for the server to read it as a clear, and
            // an empty string is what a half-typed field looks like.
            expect(submittedConfig()).toEqual({ apiKey: null });
        });
    });

    it('refuses to save a required secret that is being cleared', async () => {
        const plugin = pluginDetail({ configFields: [SECRET_FIELD], secretsConfigured: { clientSecret: true } });

        render(<PluginConfigForm plugin={plugin} />);
        await userEvent.setup().click(screen.getByRole('button', { name: 'Clear the stored value' }));
        await save();

        // Clearing it would leave the plugin without a value its own schema demands, so the form
        // stops short rather than spending a round trip on a 422.
        expect(await screen.findByText('This is required')).toBeInTheDocument();
        expect(updatePluginConfiguration).not.toHaveBeenCalled();
    });

    it('hides a dependent field until the field it depends on is answered', async () => {
        const plugin = pluginDetail({
            configFields: [
                { key: 'useProxy', label: 'Use a proxy', type: 'boolean' },
                { key: 'proxyUrl', label: 'Proxy URL', type: 'url', dependsOn: 'useProxy' },
            ],
        });
        updatePluginConfiguration.mockResolvedValue(plugin);

        render(<PluginConfigForm plugin={plugin} />);
        expect(screen.queryByLabelText('Proxy URL')).not.toBeInTheDocument();

        await userEvent.setup().click(screen.getByLabelText('Use a proxy'));

        expect(screen.getByLabelText('Proxy URL')).toBeInTheDocument();
    });

    it('puts the API validation messages on the fields they name', async () => {
        const plugin = pluginDetail({ configFields: [{ key: 'clientId', label: 'Client ID', type: 'string' }], config: { clientId: 'abc' } });
        updatePluginConfiguration.mockRejectedValue(
            new SdkError(
                422,
                'Unprocessable Entity',
                { statusCode: 422, message: 'configuration is invalid', details: { clientId: 'Too short' } },
                new Headers(),
            ),
        );

        render(<PluginConfigForm plugin={plugin} />);
        await save();

        expect(await screen.findByText('Too short')).toBeInTheDocument();
        expect(screen.queryByText('Save failed')).not.toBeInTheDocument();
    });

    it('will not submit an unanswered required field', async () => {
        const plugin = pluginDetail({ configFields: [{ key: 'clientId', label: 'Client ID', type: 'string', required: true }] });

        render(<PluginConfigForm plugin={plugin} />);
        await save();

        expect(await screen.findByText('This is required')).toBeInTheDocument();
        expect(updatePluginConfiguration).not.toHaveBeenCalled();
    });

    it('treats a stored secret as answering its own required check', async () => {
        const plugin = pluginDetail({ configFields: [SECRET_FIELD], secretsConfigured: { clientSecret: true } });
        updatePluginConfiguration.mockResolvedValue(plugin);

        render(<PluginConfigForm plugin={plugin} />);
        await save();

        await waitFor(() => {
            expect(updatePluginConfiguration).toHaveBeenCalledTimes(1);
        });
    });
});
