// Choosing the one plugin that does a job. Two things matter here and the second is the reason the
// component exists: Automatic has to say what it currently resolves to rather than leaving an
// operator to infer it, and a plugin NAMED but not running has to be loud — the station has no
// provider at all in that state, silently, because naming one is an instruction that never falls
// back.

import { describe, expect, it, vi } from 'vitest';
import type { ProviderCapabilityState } from '@deadair/sdk';

import { ProviderPick } from '../../../src/components/settings/provider.pick';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const updateSettings = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: { settings: { updateSettings: (...args: unknown[]) => updateSettings(...args) } },
}));

const candidate = (pluginId: string, name: string, position?: number, overrides: Record<string, unknown> = {}) => ({
    pluginId,
    name,
    enabled: true,
    status: 'active' as const,
    listed: false,
    inUse: false,
    ...(position === undefined ? {} : { position }),
    ...overrides,
});

function state(overrides: Partial<ProviderCapabilityState> = {}): ProviderCapabilityState {
    return {
        capability: 'speech',
        mode: 'one',
        settingKey: 'render.speechPluginId',
        configured: '',
        candidates: [candidate('deadair.kokoro', 'Kokoro', 1, { inUse: true }), candidate('deadair.chatterbox', 'Chatterbox', 2)],
        stale: [],
        unanswered: false,
        ...overrides,
    } as ProviderCapabilityState;
}

function draw(value: ProviderCapabilityState = state()) {
    updateSettings.mockResolvedValue({ descriptors: [], values: {}, configured: {} });
    render(<ProviderPick state={value} />);
    return setupUser();
}

describe('what the operator is offered', () => {
    it('names the plugin Automatic currently resolves to', () => {
        // The default was explained only in a sentence of help text under a free-text box, so
        // "which one is it actually using" was a question the page could not answer.
        draw();

        expect(screen.getByDisplayValue('Automatic (currently Kokoro)')).toBeInTheDocument();
    });

    it('offers each candidate by name', async () => {
        const user = draw();

        await user.click(screen.getByRole('combobox', { name: 'Doing this job' }));

        expect(screen.getByRole('option', { name: 'Chatterbox' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Kokoro' })).toBeInTheDocument();
    });

    it('shows the named plugin rather than Automatic once one is set', () => {
        draw(state({ configured: 'deadair.chatterbox' }));

        expect(screen.getByDisplayValue('Chatterbox')).toBeInTheDocument();
    });
});

describe('choosing one', () => {
    it('saves the plugin id behind the name', async () => {
        const user = draw();

        await user.click(screen.getByRole('combobox', { name: 'Doing this job' }));
        await user.click(screen.getByRole('option', { name: 'Chatterbox' }));

        await waitFor(() => expect(updateSettings).toHaveBeenCalled());
        expect(updateSettings.mock.calls.at(-1)?.[0]).toEqual({ values: { 'render.speechPluginId': 'deadair.chatterbox' } });
    });

    it('goes back to Automatic by storing the empty string', async () => {
        const user = draw(state({ configured: 'deadair.chatterbox' }));

        await user.click(screen.getByRole('combobox', { name: 'Doing this job' }));
        await user.click(screen.getByRole('option', { name: 'Automatic' }));

        await waitFor(() => expect(updateSettings).toHaveBeenCalled());
        expect(updateSettings.mock.calls.at(-1)?.[0]).toEqual({ values: { 'render.speechPluginId': '' } });
    });
});

describe('a named plugin that is not running', () => {
    const broken = state({
        configured: 'deadair.chatterbox',
        candidates: [
            candidate('deadair.kokoro', 'Kokoro', 1),
            candidate('deadair.chatterbox', 'Chatterbox', undefined, { status: 'disabled', enabled: false }),
        ],
        stale: ['deadair.chatterbox'],
        unanswered: true,
    });

    it('says the job is not being done at all', () => {
        // Not "it fell back to Kokoro", which is what an operator would assume from a page that
        // said nothing: the station cannot speak.
        draw(broken);

        expect(screen.getByText('Nothing is doing this job')).toBeInTheDocument();
    });

    it('keeps the named plugin in the list, flagged, rather than drawing as though nothing were set', () => {
        draw(broken);

        expect(screen.getByDisplayValue('Chatterbox (not running)')).toBeInTheDocument();
    });

    it('offers the plugin that IS running as the way out', async () => {
        const user = draw(broken);

        await user.click(screen.getByRole('combobox', { name: 'Doing this job' }));
        await user.click(screen.getByRole('option', { name: 'Kokoro' }));

        await waitFor(() => expect(updateSettings).toHaveBeenCalled());
        expect(updateSettings.mock.calls.at(-1)?.[0]).toEqual({ values: { 'render.speechPluginId': 'deadair.kokoro' } });
    });

    it('keeps an id naming nothing installed at all in the list too', () => {
        draw(
            state({
                configured: 'deadair.gone',
                candidates: [candidate('deadair.kokoro', 'Kokoro', 1)],
                stale: ['deadair.gone'],
                unanswered: true,
            }),
        );

        expect(screen.getByDisplayValue('deadair.gone (not installed)')).toBeInTheDocument();
    });

    it('says nothing alarming when the setting is simply empty', () => {
        draw();
        expect(screen.queryByText('Nothing is doing this job')).not.toBeInTheDocument();
    });
});
