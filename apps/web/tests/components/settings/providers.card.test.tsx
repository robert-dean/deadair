// The page that gathers every "which plugin does this" question into one place. What is asserted
// here is mostly about what it does NOT draw: a capability nothing can answer, and a picker for a
// capability with exactly one candidate, which is an invitation to look for a decision that does
// not exist.

import { describe, expect, it, vi } from 'vitest';
import type { ProviderCapabilityState } from '@deadair/sdk';

import { ProvidersCard } from '../../../src/components/settings/providers.card';
import { render, screen, waitFor } from '../../utils/render';

const listCapabilityProviders = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        plugins: { listCapabilityProviders: (...args: unknown[]) => listCapabilityProviders(...args) },
        settings: { updateSettings: vi.fn() },
    },
}));

const candidate = (pluginId: string, name: string, position?: number) => ({
    pluginId,
    name,
    enabled: true,
    status: 'active' as const,
    listed: false,
    inUse: true,
    ...(position === undefined ? {} : { position }),
});

const speech = (...names: string[]): ProviderCapabilityState =>
    ({
        capability: 'speech',
        mode: 'one',
        settingKey: 'render.speechPluginId',
        configured: '',
        candidates: names.map((name, index) => candidate(`deadair.${name.toLowerCase()}`, name, index + 1)),
        stale: [],
        unanswered: false,
    }) as ProviderCapabilityState;

const similarity = (...names: string[]): ProviderCapabilityState =>
    ({
        capability: 'similarity',
        mode: 'ordered',
        settingKey: 'rotation.similarityOrder',
        configured: '',
        candidates: names.map((name, index) => candidate(`deadair.${name.toLowerCase()}`, name, index + 1)),
        stale: [],
        unanswered: false,
    }) as ProviderCapabilityState;

function draw(capabilities: ProviderCapabilityState[]) {
    listCapabilityProviders.mockResolvedValue({ capabilities });
    render(<ProvidersCard />);
}

describe('what the page draws', () => {
    it('names each contested capability in the station’s own words', async () => {
        draw([speech('Kokoro', 'Chatterbox'), similarity('Deezer', 'MusicBrainz')]);

        await waitFor(() => expect(screen.getByText('Speaking')).toBeInTheDocument());
        expect(screen.getByText('Who sounds like whom')).toBeInTheDocument();
    });

    it('says what the choice actually changes, which differs per capability', async () => {
        draw([similarity('Deezer', 'MusicBrainz')]);

        // The part that used to live in a ninety-word paragraph under a table header, or nowhere.
        await waitFor(() => expect(screen.getByText(/whose judgement airs/)).toBeInTheDocument());
    });

    it('draws a picker for a capability with one answer and a list for one that asks them all', async () => {
        draw([speech('Kokoro', 'Chatterbox'), similarity('Deezer', 'MusicBrainz')]);

        await waitFor(() => expect(screen.getByRole('combobox', { name: 'Doing this job' })).toBeInTheDocument());
        expect(screen.getByLabelText('Move MusicBrainz up')).toBeInTheDocument();
    });

    it('anchors each block on its capability, so a plugin card can link straight to it', async () => {
        listCapabilityProviders.mockResolvedValue({ capabilities: [speech('Kokoro', 'Chatterbox'), similarity('Deezer', 'MusicBrainz')] });
        const { container } = render(<ProvidersCard />);

        await waitFor(() => expect(container.querySelector('#speech')).toBeInTheDocument());
        expect(container.querySelector('#similarity')).toBeInTheDocument();
    });
});

describe('a capability only one plugin can answer', () => {
    it('says so rather than drawing a picker with one option in it', async () => {
        draw([speech('Kokoro')]);

        await waitFor(() => expect(screen.getByText(/Only Kokoro can speak, so there is nothing to choose/)).toBeInTheDocument());
        expect(screen.queryByRole('combobox', { name: 'Doing this job' })).not.toBeInTheDocument();
    });

    it('says the ordering version of the same thing for a fan-out capability', async () => {
        draw([similarity('Deezer')]);

        await waitFor(() => expect(screen.getByText(/nothing to order/)).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: 'Save order' })).not.toBeInTheDocument();
    });
});

describe('a station with nothing to choose', () => {
    it('says why the page is empty rather than drawing an empty page', async () => {
        draw([]);

        await waitFor(() => expect(screen.getByText('Nothing to choose between yet')).toBeInTheDocument());
    });
});
