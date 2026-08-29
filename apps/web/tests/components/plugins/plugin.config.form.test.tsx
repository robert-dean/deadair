import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';
import type { ConfigFieldDescriptor } from '@deadair/sdk';

import { PluginConfigForm } from '../../../src/components/plugins/plugin.config.form';
import { pluginDetail } from '../../utils/plugin.fixture';
import { render, screen, setupUser, waitFor } from '../../utils/render';

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
    await setupUser().click(screen.getByRole('button', { name: 'Save configuration' }));
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
        await setupUser().type(screen.getByLabelText('Client secret', { exact: false }), 'hunter2');
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
        await setupUser().click(screen.getByRole('button', { name: 'Clear the stored value' }));

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
        await setupUser().click(screen.getByRole('button', { name: 'Clear the stored value' }));
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

        await setupUser().click(screen.getByLabelText('Use a proxy'));

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
            const user = setupUser();

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
            const user = setupUser();

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
            const user = setupUser();

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

            await setupUser().type(screen.getByLabelText('Address'), '/two');
            await save();

            await waitFor(() => {
                expect(submittedConfig()).toEqual({ feeds: JSON.stringify([{ 'feed.url': 'https://one.example.com/rss/two' }]) });
            });
        });

        it('will not save a required list nobody has filled in', async () => {
            const plugin = pluginDetail({ configFields: [{ ...FEEDS, required: true }] });

            render(<PluginConfigForm plugin={plugin} />);
            await setupUser().click(screen.getByRole('button', { name: 'Add' }));
            await save();

            // A blank row is not an answer, which is the whole difference between this and a text
            // box holding a newline.
            expect(await screen.findByText('This is required')).toBeInTheDocument();
            expect(updatePluginConfiguration).not.toHaveBeenCalled();
        });
    });

    describe('a string field with something to suggest', () => {
        it('offers its own options while still taking anything typed', async () => {
            // Suggestions rather than a whitelist, which is the difference between this and a
            // `select`: the MP3 bitrate is interpolated into the stream script, so a figure that is
            // not on the list is still honoured and has to stay typeable.
            const plugin = pluginDetail({
                configFields: [
                    {
                        key: 'bitrate',
                        label: 'Bitrate',
                        type: 'string',
                        options: [
                            { value: '128', label: '128 kbps' },
                            { value: '192', label: '192 kbps' },
                        ],
                    },
                ],
            });
            updatePluginConfiguration.mockResolvedValue(plugin);
            const user = setupUser();

            render(<PluginConfigForm plugin={plugin} />);

            // getAll: an Autocomplete carries a hidden input under the same label as its combobox,
            // exactly as a Select does above.
            const input = screen.getAllByLabelText('Bitrate')[0] as HTMLElement;

            await user.click(input);
            expect(await screen.findByText('128 kbps')).toBeInTheDocument();

            await user.type(input, '112');
            await save();

            await waitFor(() => {
                expect(submittedConfig()).toEqual({ bitrate: '112' });
            });
        });

        it("offers the platform's zones to a field that asked for them", async () => {
            // A field-level `optionsFrom`, where only columns could name one before. No request is
            // made for this one: the list is the browser's own.
            const plugin = pluginDetail({
                configFields: [{ key: 'timezone', label: 'Where the station is', type: 'string', optionsFrom: 'intl.timeZones' }],
            });
            const user = setupUser();

            render(<PluginConfigForm plugin={plugin} />);

            await user.type(screen.getAllByLabelText('Where the station is')[0] as HTMLElement, 'Europe/Lond');

            expect(await screen.findByText('Europe/London')).toBeInTheDocument();
            expect(listTopics).not.toHaveBeenCalled();
        });
    });

    describe('a string that asked to be edited as tags', () => {
        const KINDS: ConfigFieldDescriptor = { key: 'dialogueKinds', label: 'Which have callers', type: 'string', control: 'tags' };

        it('draws a chip per entry and submits the comma-separated line back', async () => {
            // The encoding does not change: this is drawn over a setting the server already splits
            // on commas, so what goes back is the same one-line string it came from.
            const plugin = pluginDetail({ configFields: [KINDS], config: { dialogueKinds: 'callin, phonein' } });
            updatePluginConfiguration.mockResolvedValue(plugin);
            const user = setupUser();

            render(<PluginConfigForm plugin={plugin} />);

            // Trimmed on the way in, exactly as `dialogueKinds()` trims on the way out — so the
            // space after the comma is not part of the second kind here or there.
            expect(screen.getByText('callin')).toBeInTheDocument();
            expect(screen.getByText('phonein')).toBeInTheDocument();

            // getAll: a TagsInput carries a hidden input under the same label as its field.
            await user.type(screen.getAllByLabelText('Which have callers')[0] as HTMLElement, 'interview{Enter}');
            await save();

            await waitFor(() => {
                expect(submittedConfig()).toEqual({ dialogueKinds: 'callin,phonein,interview' });
            });
        });

        it('removes one without the operator editing punctuation', async () => {
            // The failure a one-line list always has: taking a kind out means deleting its comma
            // too, and a leftover one is a kind the station does not have with nothing saying so.
            const plugin = pluginDetail({ configFields: [KINDS], config: { dialogueKinds: 'callin,phonein' } });
            updatePluginConfiguration.mockResolvedValue(plugin);
            const user = setupUser();

            render(<PluginConfigForm plugin={plugin} />);

            // By label rather than by role, for the reason the sustaining picker's clear cross is:
            // Mantine marks a pill's remove button `aria-hidden`, treating the combobox as the
            // control, so a role query skips it however it is asked.
            await user.click(screen.getByLabelText('Remove callin'));
            await save();

            await waitFor(() => {
                expect(submittedConfig()).toEqual({ dialogueKinds: 'phonein' });
            });
        });
    });

    describe('a number that asked for a slider', () => {
        const MIX: ConfigFieldDescriptor = {
            key: 'mix',
            label: 'Chart mix',
            type: 'number',
            unit: 'fraction',
            control: 'slider',
            min: 0,
            max: 1,
            step: 0.05,
            default: 0,
        };

        const WORKERS: ConfigFieldDescriptor = { key: 'workers', label: 'Workers', type: 'number', control: 'slider', min: 1, max: 8, default: 1 };

        it('says a share as a percentage while storing the fraction', () => {
            // The `fraction` conversion is display-only and lives in one place. An operator reading
            // `0.4` where they meant "forty percent" is the reason it exists, and a form that also
            // SUBMITTED 40 would be the much worse version of the same confusion.
            const plugin = pluginDetail({ configFields: [MIX], config: { mix: 0.4 } });

            render(<PluginConfigForm plugin={plugin} />);

            expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '0.4');
            expect(screen.getByText('40%')).toBeInTheDocument();
            // The declared ends, as marks. `100%` rather than `1`.
            expect(screen.getByText('0%')).toBeInTheDocument();
            expect(screen.getByText('100%')).toBeInTheDocument();
        });

        it('submits the position it was moved to', async () => {
            const plugin = pluginDetail({ configFields: [WORKERS], config: { workers: 3 } });
            updatePluginConfiguration.mockResolvedValue(plugin);
            const user = setupUser();

            render(<PluginConfigForm plugin={plugin} />);

            // Keyboard rather than a drag: a pointer drag needs a layout jsdom does not have, and
            // the arrow keys are the accessible path this control has to support anyway.
            screen.getByRole('slider').focus();
            await user.keyboard('{ArrowRight}');
            await save();

            await waitFor(() => {
                expect(submittedConfig()).toEqual({ workers: 4 });
            });
        });

        it('is a spinner again for a bounded number that did not ask for one', () => {
            // The half of the rule that keeps a millisecond pause typeable: bounds alone are not a
            // request, or every pace in the registry would become a control nobody can land on.
            const plugin = pluginDetail({ configFields: [{ key: 'paceMs', label: 'Pace', type: 'number', min: 0, max: 600_000 }] });

            render(<PluginConfigForm plugin={plugin} />);

            expect(screen.queryByRole('slider')).not.toBeInTheDocument();
            expect(screen.getByLabelText('Pace')).toBeInTheDocument();
        });

        it('is a spinner when a field asked for a slider without declaring its ends', () => {
            // A hint about drawing, so an incomplete one degrades rather than failing: a slider
            // with an open end has no track, and a spinner beats a blank space.
            const plugin = pluginDetail({ configFields: [{ key: 'workers', label: 'Workers', type: 'number', control: 'slider', min: 1 }] });

            render(<PluginConfigForm plugin={plugin} />);

            expect(screen.queryByRole('slider')).not.toBeInTheDocument();
            expect(screen.getByLabelText('Workers')).toBeInTheDocument();
        });
    });

    describe('two numbers that are the two ends of one range', () => {
        const LOW: ConfigFieldDescriptor = {
            key: 'storiesMin',
            label: 'Headlines in a bulletin',
            type: 'number',
            min: 1,
            max: 8,
            default: 2,
            rangeWith: 'storiesMax',
        };

        const HIGH: ConfigFieldDescriptor = { key: 'storiesMax', label: 'Headlines in a bulletin, most', type: 'number', min: 1, max: 8, default: 4 };

        it('draws one control with two handles rather than two boxes', () => {
            const plugin = pluginDetail({ configFields: [LOW, HIGH], config: { storiesMin: 2, storiesMax: 5 } });

            render(<PluginConfigForm plugin={plugin} />);

            const handles = screen.getAllByRole('slider');
            expect(handles).toHaveLength(2);
            expect(handles[0]).toHaveAttribute('aria-valuenow', '2');
            expect(handles[1]).toHaveAttribute('aria-valuenow', '5');
            // The far end's own label is never drawn: it exists so a refusal can name the key.
            expect(screen.queryByText('Headlines in a bulletin, most')).not.toBeInTheDocument();
        });

        it('submits both keys when either handle moves', async () => {
            const plugin = pluginDetail({ configFields: [LOW, HIGH], config: { storiesMin: 2, storiesMax: 5 } });
            updatePluginConfiguration.mockResolvedValue(plugin);
            const user = setupUser();

            render(<PluginConfigForm plugin={plugin} />);

            screen.getAllByRole('slider')[0]!.focus();
            await user.keyboard('{ArrowRight}');
            await save();

            await waitFor(() => {
                // Two rows, still. The control is one thing; what it writes is two settings, which
                // is what keeps `buildSubmission` ignorant of ranges entirely.
                expect(submittedConfig()).toEqual({ storiesMin: 3, storiesMax: 5 });
            });
        });

        it('will not let the lower end pass the upper one', async () => {
            // The reason the pair is one control. Two boxes could store 5 and 3, which the readers
            // behind them then disagreed about: one clamped each end where it found it, another
            // sorted them.
            const plugin = pluginDetail({ configFields: [LOW, HIGH], config: { storiesMin: 4, storiesMax: 5 } });
            updatePluginConfiguration.mockResolvedValue(plugin);
            const user = setupUser();

            render(<PluginConfigForm plugin={plugin} />);

            screen.getAllByRole('slider')[0]!.focus();
            await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
            await save();

            await waitFor(() => {
                // Three presses from 4: the lower end PUSHES the upper one from 5 to 7 rather than
                // stopping under it. Either would satisfy "the ends never cross", and this is the
                // one Mantine does — pinned exactly, because the looser assertion is also true of a
                // control that ignored every keystroke.
                expect(submittedConfig()).toEqual({ storiesMin: 7, storiesMax: 7 });
            });
        });

        it('falls back to two controls when the other end is on another page', () => {
            // A settings page draws one group of a larger set, so a `rangeWith` naming a key this
            // form does not hold is ordinary. Both ends keep an input rather than one vanishing.
            const plugin = pluginDetail({ configFields: [LOW] });

            render(<PluginConfigForm plugin={plugin} />);

            expect(screen.queryByRole('slider')).not.toBeInTheDocument();
            expect(screen.getByLabelText('Headlines in a bulletin')).toBeInTheDocument();
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
