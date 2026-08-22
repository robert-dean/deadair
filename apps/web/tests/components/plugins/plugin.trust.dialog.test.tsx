import { describe, expect, it, vi } from 'vitest';

import { PluginTrustDialog } from '../../../src/components/plugins/plugin.trust.dialog';
import { pluginSummary } from '../../utils/plugin.fixture';
import { render, screen, setupUser } from '../../utils/render';

describe('PluginTrustDialog', () => {
    it('renders the plugin name and id', () => {
        const plugin = pluginSummary({ name: 'Spotify', id: 'deadair.spotify' });

        render(<PluginTrustDialog plugin={plugin} opened onCancel={vi.fn()} onConfirm={vi.fn()} />);

        expect(screen.getByText('Enable Spotify?')).toBeInTheDocument();
        expect(screen.getByText(/deadair\.spotify/)).toBeInTheDocument();
    });

    it('calls onCancel and not onConfirm when cancelled', async () => {
        const onCancel = vi.fn();
        const onConfirm = vi.fn();
        const plugin = pluginSummary();

        render(<PluginTrustDialog plugin={plugin} opened onCancel={onCancel} onConfirm={onConfirm} />);
        await setupUser().click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('calls onConfirm when the enable button is clicked', async () => {
        const onCancel = vi.fn();
        const onConfirm = vi.fn();
        const plugin = pluginSummary({ name: 'Spotify' });

        render(<PluginTrustDialog plugin={plugin} opened onCancel={onCancel} onConfirm={onConfirm} />);
        await setupUser().click(screen.getByRole('button', { name: 'Enable Spotify' }));

        expect(onConfirm).toHaveBeenCalledTimes(1);
    });
});
