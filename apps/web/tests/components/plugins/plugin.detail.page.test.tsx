import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PluginDetailPage } from '../../../src/components/plugins/plugin.detail.page';
import { pluginDetail } from '../../utils/plugin.fixture';
import { render, screen, setupUser } from '../../utils/render';

const getPlugin = vi.fn();
const testPluginConnection = vi.fn();
const startPluginOAuthAuthorization = vi.fn();
const readFetcherAuthorization = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        plugins: {
            getPlugin: (...args: unknown[]) => getPlugin(...args),
            testPluginConnection: (...args: unknown[]) => testPluginConnection(...args),
            startPluginOAuthAuthorization: (...args: unknown[]) => startPluginOAuthAuthorization(...args),
            updatePluginConfiguration: vi.fn(),
        },
        stream: {
            readFetcherAuthorization: (...args: unknown[]) => readFetcherAuthorization(...args),
        },
    },
}));

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, className }: { children?: ReactNode; className?: string }) => (
        <a href="#" className={className}>
            {children}
        </a>
    ),
}));

const assign = vi.fn();
vi.stubGlobal('location', { ...window.location, origin: 'https://console.example', assign });

afterEach(() => {
    getPlugin.mockReset();
    testPluginConnection.mockReset();
    startPluginOAuthAuthorization.mockReset();
    readFetcherAuthorization.mockReset();
    assign.mockReset();
});

describe('PluginDetailPage', () => {
    it('shows the recorded failure of a plugin that could not start', async () => {
        getPlugin.mockResolvedValue(pluginDetail({ status: 'failed', enabled: true, lastError: 'ECONNREFUSED 127.0.0.1:4533' }));

        render(<PluginDetailPage id="deadair.spotify" />);

        expect(await screen.findByText('Last error')).toBeInTheDocument();
        expect(screen.getByText('ECONNREFUSED 127.0.0.1:4533')).toBeInTheDocument();
        expect(screen.getByText('The host could not start it. See the error below.')).toBeInTheDocument();
    });

    it('names the directory a plugin that failed to load was read from', async () => {
        getPlugin.mockResolvedValue(
            pluginDetail({ status: 'failed', origin: 'installed', dir: '/data/plugins/charts', lastError: 'entry "./dist/index.js" does not exist' }),
        );

        render(<PluginDetailPage id="charts" />);

        expect(await screen.findByText('Loaded from /data/plugins/charts')).toBeInTheDocument();
        expect(screen.getByText('Installed')).toBeInTheDocument();
    });

    it('keeps the directory out of the way of a plugin that is merely unhappy', async () => {
        getPlugin.mockResolvedValue(pluginDetail({ status: 'misconfigured', lastError: 'the client id is required' }));

        render(<PluginDetailPage id="deadair.spotify" />);

        expect(await screen.findByText('the client id is required')).toBeInTheDocument();
        expect(screen.queryByText(/Loaded from/)).not.toBeInTheDocument();
    });

    it('reports a failed connection test as an answer rather than an error', async () => {
        getPlugin.mockResolvedValue(pluginDetail());
        testPluginConnection.mockResolvedValue({ ok: false, message: 'token expired' });

        render(<PluginDetailPage id="deadair.spotify" />);
        await setupUser().click(await screen.findByRole('button', { name: 'Test connection' }));

        expect(await screen.findByText('token expired')).toBeInTheDocument();
    });

    it('sends the browser to the authorize URL the API reports', async () => {
        getPlugin.mockResolvedValue(pluginDetail());
        startPluginOAuthAuthorization.mockResolvedValue({ url: 'https://accounts.spotify.com/authorize?state=abc' });

        render(<PluginDetailPage id="deadair.spotify" />);
        await setupUser().click(await screen.findByRole('button', { name: 'Connect' }));

        await vi.waitFor(() => {
            expect(assign).toHaveBeenCalledWith('https://accounts.spotify.com/authorize?state=abc');
        });
    });

    it('shows the console callback URL an oauth plugin has to be registered with', async () => {
        getPlugin.mockResolvedValue(pluginDetail());

        render(<PluginDetailPage id="deadair.spotify" />);

        expect(await screen.findByText('https://console.example/plugins/deadair.spotify/oauth/callback')).toBeInTheDocument();
    });

    it('offers no connection card for a plugin without the oauth capability', async () => {
        getPlugin.mockResolvedValue(pluginDetail({ capabilities: ['catalog'] }));

        render(<PluginDetailPage id="deadair.spotify" />);

        expect(await screen.findByText('Settings')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
    });

    it('offers the playback authorization card to a plugin that uses the station track fetcher', async () => {
        getPlugin.mockResolvedValue(pluginDetail({ capabilities: ['catalog', 'stream', 'oauth'], usesTrackFetcher: true }));
        readFetcherAuthorization.mockResolvedValue({ reachable: true, configured: true, authorized: true, session: true });

        render(<PluginDetailPage id="deadair.spotify" />);

        expect(await screen.findByText('Playback authorization')).toBeInTheDocument();
    });

    // Navidrome streams by minting its own URLs. Keyed on the `stream` capability, its page offered
    // a Spotify fetcher login and, once enabled, warned that every record would be dropped.
    it('offers no playback authorization card to a plugin that streams without the fetcher', async () => {
        getPlugin.mockResolvedValue(
            pluginDetail({ id: 'deadair.navidrome', name: 'Navidrome', capabilities: ['catalog', 'stream', 'enrichment'], usesTrackFetcher: false }),
        );

        render(<PluginDetailPage id="deadair.navidrome" />);

        expect(await screen.findByText('Settings')).toBeInTheDocument();
        expect(screen.queryByText('Playback authorization')).not.toBeInTheDocument();
        expect(readFetcherAuthorization).not.toHaveBeenCalled();
    });
});
