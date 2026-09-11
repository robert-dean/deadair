import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { SdkError } from '@deadair/sdk';

import { PluginsPage } from '../../../src/components/plugins/plugins.page';
import { pluginSummary } from '../../utils/plugin.fixture';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const listPlugins = vi.fn();
const rescanPlugins = vi.fn();
const enablePlugin = vi.fn();
const disablePlugin = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        plugins: {
            listPlugins: () => listPlugins(),
            rescanPlugins: () => rescanPlugins(),
            enablePlugin: (...args: unknown[]) => enablePlugin(...args),
            disablePlugin: (...args: unknown[]) => disablePlugin(...args),
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

afterEach(() => {
    listPlugins.mockReset();
    rescanPlugins.mockReset();
    enablePlugin.mockReset();
    disablePlugin.mockReset();
});

describe('PluginsPage', () => {
    it('renders a card per plugin with its id, version and status', async () => {
        listPlugins.mockResolvedValue([
            pluginSummary(),
            pluginSummary({ id: 'deadair.navidrome', name: 'Navidrome', status: 'misconfigured', enabled: false }),
        ]);

        render(<PluginsPage />);

        expect(await screen.findByText('Spotify')).toBeInTheDocument();
        expect(screen.getByText('Navidrome')).toBeInTheDocument();
        expect(screen.getByText('deadair.spotify · 0.0.1')).toBeInTheDocument();
        expect(screen.getByText('Active')).toBeInTheDocument();
        expect(screen.getByText('Misconfigured')).toBeInTheDocument();
        expect(screen.getByText('2 installed')).toBeInTheDocument();
    });

    it('marks a plugin the operator installed, and leaves the bundled ones unmarked', async () => {
        listPlugins.mockResolvedValue([
            pluginSummary(),
            pluginSummary({ id: 'example.apple-music-charts', name: 'Apple Music charts', origin: 'installed' }),
        ]);

        render(<PluginsPage />);

        expect(await screen.findByText('Apple Music charts')).toBeInTheDocument();
        expect(screen.getAllByText('Installed')).toHaveLength(1);
    });

    it('says so when the host has nothing mounted', async () => {
        listPlugins.mockResolvedValue([]);

        render(<PluginsPage />);

        expect(await screen.findByText('No plugins are mounted')).toBeInTheDocument();
    });

    it('explains a rescan refused for want of permission', async () => {
        listPlugins.mockResolvedValue([pluginSummary()]);
        rescanPlugins.mockRejectedValue(new SdkError(403, 'Forbidden', { statusCode: 403, message: 'Forbidden' }, new Headers()));

        render(<PluginsPage />);
        await setupUser().click(await screen.findByRole('button', { name: 'Rescan' }));

        expect(await screen.findByText('Rescanning the plugin directory is an administrator action.')).toBeInTheDocument();
    });

    it('turns a plugin off through the card switch', async () => {
        listPlugins.mockResolvedValueOnce([pluginSummary()]).mockResolvedValue([pluginSummary({ enabled: false, status: 'disabled' })]);
        disablePlugin.mockResolvedValue({ ...pluginSummary({ enabled: false, status: 'disabled' }), config: {} });

        render(<PluginsPage />);
        await setupUser().click(await screen.findByLabelText('Enable Spotify'));

        await waitFor(() => {
            expect(screen.getByLabelText('Enable Spotify')).not.toBeChecked();
        });
        expect(disablePlugin).toHaveBeenCalledWith('deadair.spotify');
        // The card is patched from the response so it does not blank mid-toggle, and then the
        // list is re-read: the API reinitializes the plugin only once the request that flipped
        // the flag has committed, so the status in that response is the one it had on the way in.
        await waitFor(() => {
            expect(listPlugins).toHaveBeenCalledTimes(2);
        });
    });
    /**
     * The trust dialog is the moment an operator agrees to run somebody else's code in this process,
     * and it is asked once. Asking on every enable says the answer was never recorded, when the
     * server has held it since the first time.
     */
    it('asks before enabling a plugin that has never been on', async () => {
        const never = pluginSummary({ enabled: false, status: 'disabled', firstEnabledAt: undefined });
        listPlugins.mockResolvedValue([never]);

        render(<PluginsPage />);
        await setupUser().click(await screen.findByLabelText('Enable Spotify'));

        expect(await screen.findByRole('button', { name: 'Enable Spotify' })).toBeInTheDocument();
        expect(enablePlugin).not.toHaveBeenCalled();
    });

    it('does not ask again for one the operator has already trusted', async () => {
        const trusted = pluginSummary({ enabled: false, status: 'disabled', firstEnabledAt: DateTime.fromISO('2026-08-01T12:00:00.000Z') });
        listPlugins.mockResolvedValue([trusted]);
        enablePlugin.mockResolvedValue({ ...pluginSummary(), config: {} });

        render(<PluginsPage />);
        await setupUser().click(await screen.findByLabelText('Enable Spotify'));

        await waitFor(() => {
            expect(enablePlugin).toHaveBeenCalledWith('deadair.spotify');
        });
        expect(screen.queryByRole('button', { name: 'Enable Spotify' })).not.toBeInTheDocument();
    });
});
