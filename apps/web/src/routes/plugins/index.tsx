import { createFileRoute } from '@tanstack/react-router';

import { pluginsListOptions } from '../../api/plugins.queries';
import { PluginsPage } from '../../components/plugins/plugins.page';
import { SettingsShell } from '../../components/settings/settings.shell';

export const Route = createFileRoute('/plugins/')({
    component: PluginsRoute,
    // Warms the same cache the page's hook reads from, so the loader and the render are one
    // request rather than two. The rejection is swallowed on purpose: the failure stays in the
    // query cache for the page's own "plugin catalogue is unavailable" alert to render, which
    // keeps the Rescan button reachable instead of abandoning the navigation to the router's
    // default error component. See the sibling `$id` route.
    loader: async ({ context }) => {
        await context.queryClient.ensureQueryData(pluginsListOptions).catch(() => undefined);
    },
});

/**
 * The plugin list, presented as a section of Settings.
 *
 * Its own route rather than a card on the settings page: it is a card per plugin, with OAuth
 * callbacks and a detail page underneath. It belongs under Settings by subject — a plugin is a
 * thing you configure — and the shared section list is what makes that true for somebody
 * navigating, without pretending a whole page is a card.
 */
function PluginsRoute() {
    return (
        <SettingsShell active="plugins">
            <PluginsPage />
        </SettingsShell>
    );
}
