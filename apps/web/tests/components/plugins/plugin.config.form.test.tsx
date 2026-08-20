import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { SdkError } from '@deadair/sdk';
import type { ConfigFieldDescriptor } from '@deadair/sdk';

import { PluginConfigForm } from '../../../src/components/plugins/plugin.config.form';
import { pluginDetail } from '../../utils/plugin.fixture';
import { render, screen, waitFor } from '../../utils/render';

const updatePluginConfiguration = vi.fn();
const listTopics = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        plugins: {
            updatePluginConfiguration: (...args: unknown[]) => updatePluginConfiguration(...args),
        },
        topics: {
            listTopics: (...args: unknown[]) => listTopics(...args),
        },
    },
}));

afterEach(() => {
    updatePluginConfiguration.mockReset();
    listTopics.mockReset();
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

    describe('a list of rows', () => {
        const FEEDS: ConfigFieldDescriptor = {
            key: 'feeds',
            label: 'Feeds',
            type: 'list',
            columns: [
                { key: 'name', label: 'Name', type: 'string' },
                { key: 'url', label: 'Address', type: 'url' },
                { key: 'category', label: 'Category', type: 'string', optionsFrom: 'station.newsCategories' },
            ],
        };

        const withRows = (...rows: Record<string, string>[]) => pluginDetail({ configFields: [FEEDS], config: { feeds: JSON.stringify(rows) } });

        it('draws a row per stored entry and submits what was typed into a new one', async () => {
            const plugin = withRows({ name: 'World', url: 'https://one.example.com/rss', category: 'world' });
            updatePluginConfiguration.mockResolvedValue(plugin);
            const user = userEvent.setup();

            render(<PluginConfigForm plugin={plugin} />);

            expect(screen.getByDisplayValue('https://one.example.com/rss')).toBeInTheDocument();

            await user.click(screen.getByRole('button', { name: 'Add' }));
            await user.type(screen.getAllByLabelText('Address')[1] as HTMLElement, 'https://two.example.net/rss');
            await save();

            await waitFor(() => {
                expect(submittedConfig()).toEqual({
                    feeds: JSON.stringify([
                        { name: 'World', url: 'https://one.example.com/rss', category: 'world' },
                        // A cell nobody filled in is absent rather than empty: not set is not the
                        // same claim as set to nothing.
                        { url: 'https://two.example.net/rss' },
                    ]),
                });
            });
        });

        it('drops a row the operator removed, and one they added and left blank', async () => {
            const plugin = withRows({ name: 'World', url: 'https://one.example.com/rss' }, { name: 'Sport', url: 'https://two.example.net/rss' });
            updatePluginConfiguration.mockResolvedValue(plugin);
            const user = userEvent.setup();

            render(<PluginConfigForm plugin={plugin} />);

            await user.click(screen.getByRole('button', { name: 'Remove row 1' }));
            await user.click(screen.getByRole('button', { name: 'Add' }));
            await save();

            await waitFor(() => {
                expect(submittedConfig()).toEqual({ feeds: JSON.stringify([{ name: 'Sport', url: 'https://two.example.net/rss' }]) });
            });
        });

        it("offers the station's own categories in a column that asked for them", async () => {
            listTopics.mockResolvedValue({
                topics: [
                    { id: '1', kind: 'news', key: 'sport', label: 'Sport', config: {}, position: 0 },
                    { id: '2', kind: 'weather', key: 'home', label: 'Home', config: {}, position: 1 },
                ],
            });
            const plugin = withRows({ name: 'World', url: 'https://one.example.com/rss' });
            const user = userEvent.setup();

            render(<PluginConfigForm plugin={plugin} />);

            await user.click(screen.getByLabelText('Category'));

            // The station's news categories, and only those: a weather location is a subject for a
            // different sort of break entirely.
            expect(await screen.findByText('Sport')).toBeInTheDocument();
            expect(screen.queryByText('Home')).not.toBeInTheDocument();
        });

        it('takes a column key with a dot in it, which the form never lets reach an input name', async () => {
            // A dot in a path means a step into a nested object, so a cell named after this key
            // would draw empty and submit nothing. The form names its inputs positionally and puts
            // the real key back on the way out, so a plugin can key its columns however it likes.
            const dotted: ConfigFieldDescriptor = {
                key: 'feeds',
                label: 'Feeds',
                type: 'list',
                columns: [{ key: 'feed.url', label: 'Address', type: 'url' }],
            };
            const plugin = pluginDetail({
                configFields: [dotted],
                config: { feeds: JSON.stringify([{ 'feed.url': 'https://one.example.com/rss' }]) },
            });
            updatePluginConfiguration.mockResolvedValue(plugin);

            render(<PluginConfigForm plugin={plugin} />);

            expect(screen.getByDisplayValue('https://one.example.com/rss')).toBeInTheDocument();

            await userEvent.setup().type(screen.getByLabelText('Address'), '/two');
            await save();

            await waitFor(() => {
                expect(submittedConfig()).toEqual({ feeds: JSON.stringify([{ 'feed.url': 'https://one.example.com/rss/two' }]) });
            });
        });

        it('will not save a required list nobody has filled in', async () => {
            const plugin = pluginDetail({ configFields: [{ ...FEEDS, required: true }] });

            render(<PluginConfigForm plugin={plugin} />);
            await userEvent.setup().click(screen.getByRole('button', { name: 'Add' }));
            await save();

            // A blank row is not an answer, which is the whole difference between this and a text
            // box holding a newline.
            expect(await screen.findByText('This is required')).toBeInTheDocument();
            expect(updatePluginConfiguration).not.toHaveBeenCalled();
        });
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
