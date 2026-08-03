import { createFileRoute } from '@tanstack/react-router';

import { pluginsListOptions } from '../../api/plugins.queries';
import { PluginsPage } from '../../components/plugins/plugins.page';

export const Route = createFileRoute('/plugins/')({
    component: PluginsPage,
    // Warms the same cache the page's hook reads from, so the loader and the render are one
    // request rather than two. The rejection is swallowed on purpose: the failure stays in the
    // query cache for the page's own "plugin catalogue is unavailable" alert to render, which
    // keeps the Rescan button reachable instead of abandoning the navigation to the router's
    // default error component. See the sibling `$id` route.
    loader: async ({ context }) => {
        await context.queryClient.ensureQueryData(pluginsListOptions).catch(() => undefined);
    },
});
