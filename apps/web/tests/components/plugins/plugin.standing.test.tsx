// The line on a plugin that says what the station does with it. Its whole job is to make a choice
// visible from where the operator is standing when they make it — the moment they install a second
// plugin that can do the same thing — so what is pinned here is mostly when it says NOTHING: a job
// only this plugin can do is not a decision, and reporting it is the noise that hides the rest.

import { describe, expect, it, vi } from 'vitest';
import type { ProviderCapabilityState } from '@deadair/sdk';

import { PluginStanding } from '../../../src/components/plugins/plugin.standing';
import { render, screen, waitFor } from '../../utils/render';

const listCapabilityProviders = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: { plugins: { listCapabilityProviders: (...args: unknown[]) => listCapabilityProviders(...args) } },
}));

vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, hash, children, ...props }: { to?: string; hash?: string; children?: React.ReactNode }) => (
        <a href={hash === undefined ? to : `${to}#${hash}`} {...props}>
            {children}
        </a>
    ),
}));

const candidate = (pluginId: string, position?: number, overrides: Record<string, unknown> = {}) => ({
    pluginId,
    name: pluginId,
    enabled: true,
    status: 'active' as const,
    listed: false,
    inUse: position !== undefined,
    ...(position === undefined ? {} : { position }),
    ...overrides,
});

function state(overrides: Partial<ProviderCapabilityState> = {}): ProviderCapabilityState {
    return {
        capability: 'similarity',
        mode: 'ordered',
        settingKey: 'rotation.similarityOrder',
        configured: '',
        candidates: [candidate('deadair.deezer', 1), candidate('deadair.lastfm', 2), candidate('deadair.musicbrainz', 3)],
        stale: [],
        unanswered: false,
        ...overrides,
    } as ProviderCapabilityState;
}

function draw(pluginId: string, capabilities: ProviderCapabilityState[]) {
    listCapabilityProviders.mockResolvedValue({ capabilities });
    return render(<PluginStanding pluginId={pluginId} />);
}

describe('a job several plugins can do', () => {
    it('says where in the asking order this one sits', async () => {
        draw('deadair.lastfm', [state()]);

        await waitFor(() => expect(screen.getByText('asked 2nd of 3 for who sounds like whom')).toBeInTheDocument());
    });

    it('counts only the plugins that can actually answer', async () => {
        draw('deadair.deezer', [
            state({
                candidates: [candidate('deadair.deezer', 1), candidate('deadair.lastfm', undefined, { status: 'disabled', enabled: false })],
            }),
        ]);

        await waitFor(() => expect(screen.getByText('asked 1st of 1 for who sounds like whom')).toBeInTheDocument());
    });

    it('links to the block on the Providers page that decides it', async () => {
        draw('deadair.lastfm', [state()]);

        await waitFor(() => expect(screen.getByRole('link')).toHaveAttribute('href', '/settings/providers#similarity'));
    });

    it('says a plugin that cannot currently answer is not asked', async () => {
        draw('deadair.lastfm', [
            state({
                candidates: [candidate('deadair.deezer', 1), candidate('deadair.lastfm', undefined, { status: 'disabled', enabled: false })],
            }),
        ]);

        await waitFor(() => expect(screen.getByText('not asked for who sounds like whom')).toBeInTheDocument());
    });
});

describe('a job with one answer', () => {
    const speech = (overrides: Partial<ProviderCapabilityState> = {}): ProviderCapabilityState =>
        ({
            capability: 'speech',
            mode: 'one',
            settingKey: 'render.speechPluginId',
            configured: '',
            candidates: [candidate('deadair.kokoro', 1), candidate('deadair.chatterbox', 2, { inUse: false })],
            stale: [],
            unanswered: false,
            ...overrides,
        }) as ProviderCapabilityState;

    it('says which one the station is using', async () => {
        draw('deadair.kokoro', [speech()]);

        await waitFor(() => expect(screen.getByText('in use for speaking')).toBeInTheDocument());
    });

    it('says when one could do the job and is not the one chosen', async () => {
        draw('deadair.chatterbox', [speech()]);

        await waitFor(() => expect(screen.getByText('could do speaking, and is not the one in use')).toBeInTheDocument());
    });

    it('says loudly when this plugin is the one named and is not running', async () => {
        // The state that leaves the station doing the job with nothing at all, said on the page
        // somebody is standing on when they switch the plugin off.
        draw('deadair.chatterbox', [
            speech({
                configured: 'deadair.chatterbox',
                candidates: [candidate('deadair.chatterbox', undefined, { status: 'disabled', enabled: false, listed: true })],
                stale: ['deadair.chatterbox'],
                unanswered: true,
            }),
        ]);

        await waitFor(() => expect(screen.getByText('named for speaking, and not running')).toBeInTheDocument());
    });
});

describe('when it says nothing at all', () => {
    it('says nothing for a job only this plugin can do', async () => {
        // "Asked 1st of 1" is a decision reported where no decision exists.
        draw('deadair.deezer', [state({ candidates: [candidate('deadair.deezer', 1)] })]);

        await waitFor(() => expect(listCapabilityProviders).toHaveBeenCalled());
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('says nothing about a capability this plugin does not have', async () => {
        draw('deadair.spotify', [state()]);

        await waitFor(() => expect(listCapabilityProviders).toHaveBeenCalled());
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('stays quiet rather than showing an error when the station cannot answer', async () => {
        // It annotates something already on screen, and is worth nothing at the cost of an error
        // where a line should be.
        listCapabilityProviders.mockRejectedValue(new Error('nope'));
        render(<PluginStanding pluginId="deadair.deezer" />);

        await waitFor(() => expect(listCapabilityProviders).toHaveBeenCalled());
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
});
