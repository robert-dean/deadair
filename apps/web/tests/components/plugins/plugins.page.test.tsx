import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { SdkError } from '@deadair/sdk';

import { PluginsPage } from '../../../src/components/plugins/plugins.page';
import { pluginSummary } from '../../utils/plugin.fixture';
import { render, screen, waitFor } from '../../utils/render';

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

    it('says so when the host has nothing mounted', async () => {
        listPlugins.mockResolvedValue([]);

        render(<PluginsPage />);

        expect(await screen.findByText('No plugins are mounted')).toBeInTheDocument();
    });

    it('explains a rescan refused for want of permission', async () => {
        listPlugins.mockResolvedValue([pluginSummary()]);
        rescanPlugins.mockRejectedValue(new SdkError(403, 'Forbidden', { statusCode: 403, message: 'Forbidden' }, new Headers()));

        render(<PluginsPage />);
        await userEvent.setup().click(await screen.findByRole('button', { name: 'Rescan' }));

        expect(await screen.findByText('Rescanning the plugin directory is an administrator action.')).toBeInTheDocument();
    });

    it('turns a plugin off through the card switch', async () => {
        listPlugins.mockResolvedValue([pluginSummary()]);
        disablePlugin.mockResolvedValue({ ...pluginSummary({ enabled: false, status: 'disabled' }), config: {} });

        render(<PluginsPage />);
        await userEvent.setup().click(await screen.findByLabelText('Enable Spotify'));

        await waitFor(() => {
            expect(screen.getByLabelText('Enable Spotify')).not.toBeChecked();
        });
        expect(disablePlugin).toHaveBeenCalledWith('deadair.spotify');
        // The response is the truth, so the list is patched from it rather than re-fetched.
        expect(listPlugins).toHaveBeenCalledTimes(1);
    });
});
