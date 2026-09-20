// The order a capability's plugins are asked in. What matters here is the thing the generic `list`
// field could not do: the list starts filled in with the order the station is ACTUALLY using, by
// name, so moving one thing is one click rather than rebuilding the default first. And that a save
// writes the whole list, because an operator looking at four and moving one has said something
// about all four.

import { describe, expect, it, vi } from 'vitest';
import type { ProviderCapabilityState } from '@deadair/sdk';

import { ProviderRanking } from '../../../src/components/settings/provider.ranking';
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
    inUse: true,
    ...(position === undefined ? {} : { position }),
    ...overrides,
});

function state(overrides: Partial<ProviderCapabilityState> = {}): ProviderCapabilityState {
    return {
        capability: 'similarity',
        mode: 'ordered',
        settingKey: 'rotation.similarityOrder',
        configured: '',
        candidates: [candidate('deadair.deezer', 'Deezer', 1), candidate('deadair.lastfm', 'Last.fm', 2), candidate('deadair.musicbrainz', 'MusicBrainz', 3)],
        stale: [],
        unanswered: false,
        ...overrides,
    } as ProviderCapabilityState;
}

/** What the component sent, parsed back out of the string the setting is stored as. */
function saved(): string[] {
    const body = updateSettings.mock.calls.at(-1)?.[0] as { values: Record<string, unknown> };
    const raw = body.values['rotation.similarityOrder'];
    return (JSON.parse(raw as string) as { source: string }[]).map(row => row.source);
}

function draw(value: ProviderCapabilityState = state()) {
    updateSettings.mockResolvedValue({ descriptors: [], values: {}, configured: {} });
    render(<ProviderRanking state={value} />);
    return setupUser();
}

describe('the list an operator arrives at', () => {
    it('is already the order the station is using, by name', async () => {
        draw();

        // Not an empty table with a placeholder explaining that sources are asked alphabetically,
        // which is what an operator had to reproduce by hand before they could depart from it.
        expect(screen.getByText('Deezer')).toBeInTheDocument();
        expect(screen.getByText('Last.fm')).toBeInTheDocument();
        expect(screen.getByText('MusicBrainz')).toBeInTheDocument();
    });

    it('shows no plugin ids, which is what the old table led with', () => {
        draw();

        expect(screen.queryByText('deadair.deezer')).not.toBeInTheDocument();
    });

    it('says whether this is the station’s default or a choice somebody made', () => {
        draw();
        expect(screen.getByText('Default order')).toBeInTheDocument();
    });

    it('says so when the order is the operator’s own', () => {
        draw(state({ configured: JSON.stringify([{ source: 'deadair.musicbrainz' }]) }));
        expect(screen.getByText('Your order')).toBeInTheDocument();
    });
});

describe('changing the order', () => {
    it('moves a plugin up by its own name and saves the whole list', async () => {
        const user = draw();

        await user.click(screen.getByLabelText('Move MusicBrainz up'));
        await user.click(screen.getByRole('button', { name: 'Save order' }));

        await waitFor(() => expect(updateSettings).toHaveBeenCalled());
        expect(saved()).toEqual(['deadair.deezer', 'deadair.musicbrainz', 'deadair.lastfm']);
    });

    it('moves one down as well', async () => {
        const user = draw();

        await user.click(screen.getByLabelText('Move Deezer down'));
        await user.click(screen.getByRole('button', { name: 'Save order' }));

        await waitFor(() => expect(updateSettings).toHaveBeenCalled());
        expect(saved()).toEqual(['deadair.lastfm', 'deadair.deezer', 'deadair.musicbrainz']);
    });

    it('cannot move the top one up or the bottom one down', () => {
        draw();

        expect(screen.getByLabelText('Move Deezer up')).toBeDisabled();
        expect(screen.getByLabelText('Move MusicBrainz down')).toBeDisabled();
    });

    it('offers nothing to save until something has moved', async () => {
        const user = draw();

        expect(screen.getByRole('button', { name: 'Save order' })).toBeDisabled();

        await user.click(screen.getByLabelText('Move Last.fm up'));
        expect(screen.getByRole('button', { name: 'Save order' })).toBeEnabled();
    });
});

describe('going back to the default', () => {
    it('is not offered when the operator has set nothing', () => {
        draw();
        expect(screen.queryByRole('button', { name: 'Reset to default' })).not.toBeInTheDocument();
    });

    it('clears the setting rather than storing an empty list', async () => {
        const user = draw(state({ configured: JSON.stringify([{ source: 'deadair.musicbrainz' }]) }));

        await user.click(screen.getByRole('button', { name: 'Reset to default' }));

        await waitFor(() => expect(updateSettings).toHaveBeenCalled());
        // `null` is the absence of a decision. An empty list means the same thing to the station
        // today and reads as one somebody made.
        expect(updateSettings.mock.calls.at(-1)?.[0]).toEqual({ values: { 'rotation.similarityOrder': null } });
    });
});

describe('plugins that cannot answer', () => {
    it('draws one that is installed and not running, outside the order', () => {
        draw(
            state({
                candidates: [
                    candidate('deadair.deezer', 'Deezer', 1),
                    candidate('deadair.lastfm', 'Last.fm', undefined, { status: 'disabled', enabled: false, inUse: false }),
                ],
            }),
        );

        expect(screen.getByText('Last.fm')).toBeInTheDocument();
        expect(screen.getByText('not switched on, so it is not asked')).toBeInTheDocument();
        expect(screen.queryByLabelText('Move Last.fm up')).not.toBeInTheDocument();
    });

    it('distinguishes one switched on and failing from one never switched on', () => {
        draw(
            state({
                candidates: [
                    candidate('deadair.deezer', 'Deezer', 1),
                    candidate('deadair.lastfm', 'Last.fm', undefined, { status: 'failed', enabled: true, inUse: false }),
                ],
            }),
        );

        expect(screen.getByText('switched on and not answering, so it is not asked')).toBeInTheDocument();
    });

    it('says when a saved order names something nothing answers to', () => {
        // Harmless to the station, and invisible until now: a row that does nothing looks exactly
        // like one that works.
        draw(state({ configured: JSON.stringify([{ source: 'deadair.gone' }]), stale: ['deadair.gone'] }));

        expect(screen.getByText('1 listed plugin is not running')).toBeInTheDocument();
        expect(screen.getByText(/deadair\.gone/)).toBeInTheDocument();
    });
});
