import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { SdkError } from '@deadair/sdk';

import { PLUGINS_PAGE_DEFAULTS, type PluginsPageParams } from '../../../src/components/plugins/plugin.page.params';
import { PluginsPage as Page } from '../../../src/components/plugins/plugins.page';
import { pluginSummary } from '../../utils/plugin.fixture';
import { render, screen, setupUser, waitFor, within } from '../../utils/render';

const listPlugins = vi.fn();
const rescanPlugins = vi.fn();
const enablePlugin = vi.fn();
const disablePlugin = vi.fn();
const importPlugin = vi.fn();
const getPlugin = vi.fn();
const listPluginGrants = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        plugins: {
            listPlugins: () => listPlugins(),
            rescanPlugins: () => rescanPlugins(),
            enablePlugin: (...args: unknown[]) => enablePlugin(...args),
            disablePlugin: (...args: unknown[]) => disablePlugin(...args),
            importPlugin: (...args: unknown[]) => importPlugin(...args),
            getPlugin: (...args: unknown[]) => getPlugin(...args),
            listPluginGrants: () => listPluginGrants(),
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
    importPlugin.mockReset();
    getPlugin.mockReset();
    listPluginGrants.mockReset();
});

/** The page with its params held the way the route holds them, so filtering can be driven end to end. */
function PluginsPage({ initial = PLUGINS_PAGE_DEFAULTS }: { initial?: PluginsPageParams }) {
    const [params, setParams] = useState(initial);
    return <Page params={params} onParamsChange={next => setParams(previous => ({ ...previous, ...next }))} />;
}

/** A tarball as the browser hands one over. Its bytes are the server's business. */
const tarball = () => new File([new Uint8Array([0x1f, 0x8b, 0x08])], 'apple-music-charts-0.1.0.tgz', { type: 'application/gzip' });

/** Opens the import dialog, chooses a tarball, and presses Import. */
async function importTarball(): Promise<void> {
    const user = setupUser();
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    await user.upload(await screen.findByLabelText('Plugin tarball'), tarball());
    const dialog = await screen.findByRole('dialog', { name: 'Import a plugin' });
    await user.click(within(dialog).getByRole('button', { name: 'Import' }));
}

describe('PluginsPage', () => {
    it('renders a card per plugin with its id, version and status', async () => {
        listPlugins.mockResolvedValue([
            pluginSummary(),
            pluginSummary({ id: 'deadair.navidrome', name: 'Navidrome', status: 'misconfigured', enabled: false }),
        ]);

        render(<PluginsPage initial={{ q: '', show: 'all', view: 'cards' }} />);

        expect(await screen.findByText('Spotify')).toBeInTheDocument();
        const cards = screen.getByRole('region', { name: 'Music sources' });
        expect(within(cards).getByText('Navidrome')).toBeInTheDocument();
        expect(within(cards).getByText('deadair.spotify · 0.0.1')).toBeInTheDocument();
        expect(within(cards).getByText('Active')).toBeInTheDocument();
        expect(within(cards).getByText('Misconfigured')).toBeInTheDocument();
        expect(screen.getByText('2 installed')).toBeInTheDocument();
    });

    it('files the cards under what each plugin does, in role order', async () => {
        listPlugins.mockResolvedValue([
            pluginSummary({ id: 'deadair.rss', name: 'RSS', capabilities: ['news'] }),
            pluginSummary({ id: 'deadair.kokoro', name: 'Kokoro', capabilities: ['speech'] }),
            pluginSummary(),
        ]);

        render(<PluginsPage />);

        expect(await screen.findByText('Kokoro')).toBeInTheDocument();
        const groups = screen.getAllByRole('region').map(region => region.getAttribute('aria-label'));
        expect(groups).toEqual(['Music sources', 'Voice', 'News & programmes']);
        expect(within(screen.getByRole('region', { name: 'Voice' })).getByText('Kokoro')).toBeInTheDocument();
    });

    it('narrows the cards to a search, and counts each filter against it', async () => {
        listPlugins.mockResolvedValue([
            pluginSummary(),
            pluginSummary({ id: 'deadair.kokoro', name: 'Kokoro', capabilities: ['speech'] }),
            pluginSummary({ id: 'deadair.rhapsode', name: 'Rhapsode', capabilities: ['speech'], status: 'failed' }),
        ]);

        render(<PluginsPage initial={{ q: '', show: 'all', view: 'cards' }} />);
        await setupUser().type(await screen.findByLabelText('Search plugins'), 'voice');

        await waitFor(() => {
            expect(screen.queryByText('Spotify')).not.toBeInTheDocument();
        });
        const voice = screen.getByRole('region', { name: 'Voice' });
        expect(within(voice).getByText('Kokoro')).toBeInTheDocument();
        expect(within(voice).getByText('Rhapsode')).toBeInTheDocument();
        expect(screen.getByText('All 2')).toBeInTheDocument();
        expect(screen.getByText('Needs attention 1')).toBeInTheDocument();
    });

    it('shows only what needs attention, and offers a way back when nothing matches', async () => {
        listPlugins.mockResolvedValue([pluginSummary()]);

        render(<PluginsPage initial={{ q: '', show: 'attention', view: 'cards' }} />);

        expect(await screen.findByText('No plugins match')).toBeInTheDocument();
        expect(screen.queryByText('Spotify')).not.toBeInTheDocument();

        await setupUser().click(screen.getByRole('button', { name: 'Clear filters' }));
        expect(await screen.findByText('Spotify')).toBeInTheDocument();
    });

    it('lists what needs attention above the groups, with the reason on the row and the card', async () => {
        listPlugins.mockResolvedValue([
            pluginSummary(),
            pluginSummary({
                id: 'deadair.kokoro',
                name: 'Kokoro',
                capabilities: ['speech'],
                status: 'failed',
                lastError: 'connect ECONNREFUSED 10.0.0.2:8880\n    at TCPConnectWrap',
            }),
        ]);

        render(<PluginsPage initial={{ q: '', show: 'all', view: 'cards' }} />);

        const strip = await screen.findByRole('alert');
        expect(within(strip).getByText('1 plugin needs attention')).toBeInTheDocument();
        expect(within(strip).getByText('Kokoro')).toBeInTheDocument();
        expect(within(strip).getByText('connect ECONNREFUSED 10.0.0.2:8880')).toBeInTheDocument();
        expect(within(screen.getByRole('region', { name: 'Voice' })).getByTitle(/ECONNREFUSED/)).toBeInTheDocument();
    });

    it('draws no attention strip when everything is healthy, or when the cards already are that list', async () => {
        listPlugins.mockResolvedValue([
            pluginSummary(),
            pluginSummary({ id: 'deadair.rss', name: 'RSS', capabilities: ['news'], status: 'misconfigured' }),
        ]);

        const { unmount } = render(<PluginsPage initial={{ q: '', show: 'attention', view: 'cards' }} />);
        expect(await screen.findByText('RSS')).toBeInTheDocument();
        expect(screen.queryByText('1 plugin needs attention')).not.toBeInTheDocument();
        unmount();

        listPlugins.mockResolvedValue([pluginSummary()]);
        render(<PluginsPage />);
        expect(await screen.findByText('Spotify')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('draws the same groups as a table, with a working switch on every row', async () => {
        listPlugins.mockResolvedValue([
            pluginSummary(),
            pluginSummary({ id: 'deadair.kokoro', name: 'Kokoro', capabilities: ['speech'], status: 'failed', lastError: 'connect ECONNREFUSED' }),
        ]);
        disablePlugin.mockResolvedValue({ ...pluginSummary({ enabled: false, status: 'disabled' }), config: {} });

        render(<PluginsPage initial={{ q: '', show: 'all', view: 'table' }} />);

        const table = await screen.findByRole('table');
        expect(within(table).getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
        const voice = within(table)
            .getAllByRole('rowgroup')
            .find(group => group.getAttribute('aria-label') === 'Voice');
        expect(voice && within(voice).getByText('Kokoro')).toBeInTheDocument();
        expect(within(table).getByTitle('connect ECONNREFUSED')).toBeInTheDocument();
        expect(within(table).getByText('Library')).toBeInTheDocument();

        await setupUser().click(within(table).getByLabelText('Enable Spotify'));
        await waitFor(() => {
            expect(disablePlugin).toHaveBeenCalledWith('deadair.spotify');
        });
    });

    it('switches between cards and the table from the toolbar', async () => {
        listPlugins.mockResolvedValue([pluginSummary()]);

        render(<PluginsPage />);
        expect(await screen.findByText('Spotify')).toBeInTheDocument();
        expect(screen.queryByRole('table')).not.toBeInTheDocument();

        await setupUser().click(screen.getByText('Table'));
        expect(await screen.findByRole('table')).toBeInTheDocument();
    });

    it('opens on what needs attention when anything does', async () => {
        listPlugins.mockResolvedValue([pluginSummary(), pluginSummary({ id: 'deadair.rss', name: 'RSS', capabilities: ['news'], status: 'failed' })]);

        render(<PluginsPage />);

        expect(await screen.findByText('RSS')).toBeInTheDocument();
        expect(screen.queryByText('Spotify')).not.toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Needs attention 1' })).toBeChecked();
    });

    it('opens on what is switched on when nothing needs attention', async () => {
        listPlugins.mockResolvedValue([
            pluginSummary(),
            pluginSummary({ id: 'deadair.rss', name: 'RSS', capabilities: ['news'], enabled: false, status: 'disabled' }),
        ]);

        render(<PluginsPage />);

        expect(await screen.findByText('Spotify')).toBeInTheDocument();
        expect(screen.queryByText('RSS')).not.toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Enabled 1' })).toBeChecked();
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
    it('imports a tarball and files the catalogue the server answers with', async () => {
        const imported = pluginSummary({ id: 'example.apple-music-charts', name: 'Apple Music charts', origin: 'installed', enabled: false });
        listPlugins.mockResolvedValue([pluginSummary()]);
        importPlugin.mockResolvedValue({ pluginId: imported.id, restartRequired: false, plugins: [pluginSummary(), imported] });

        render(<PluginsPage initial={{ q: '', show: 'all', view: 'cards' }} />);
        await importTarball();

        expect(await screen.findByText('Apple Music charts')).toBeInTheDocument();
        const body = importPlugin.mock.calls[0]?.[0] as FormData;
        expect((body.get('file') as File).name).toBe('apple-music-charts-0.1.0.tgz');
        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: 'Import a plugin' })).not.toBeInTheDocument();
        });
    });

    it('stays open to say a restart is needed when the same version was already loaded', async () => {
        listPlugins.mockResolvedValue([pluginSummary()]);
        importPlugin.mockResolvedValue({ pluginId: 'deadair.spotify', restartRequired: true, plugins: [pluginSummary()] });

        render(<PluginsPage />);
        await importTarball();

        expect(await screen.findByText('Restart the station to run the new build')).toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: 'Import a plugin' })).toBeInTheDocument();
    });

    it('shows the station own reason when it refuses a plugin', async () => {
        listPlugins.mockResolvedValue([pluginSummary()]);
        const reason = 'my-charts 1.0.0 did not load: invalid manifest: id: Invalid string';
        importPlugin.mockRejectedValue(
            new SdkError(
                422,
                'Unprocessable Entity',
                { statusCode: 422, message: 'Unprocessable Entity', details: { message: reason } },
                new Headers(),
            ),
        );

        render(<PluginsPage />);
        await importTarball();

        expect(await screen.findByText(reason)).toBeInTheDocument();
    });

    it('explains an import refused for want of permission', async () => {
        listPlugins.mockResolvedValue([pluginSummary()]);
        importPlugin.mockRejectedValue(new SdkError(403, 'Forbidden', { statusCode: 403, message: 'Forbidden' }, new Headers()));

        render(<PluginsPage />);
        await importTarball();

        expect(await screen.findByText('Importing a plugin is an administrator action.')).toBeInTheDocument();
    });
});
