import { createFileRoute } from '@tanstack/react-router';

import { pluginsListOptions } from '../../api/plugins.queries';
import { PluginsPage } from '../../components/plugins/plugins.page';

export const Route = createFileRoute('/plugins/')({
    component: PluginsPage,
    // Reads through the same cache the page's hook reads from, so the loader and the render are
    // one request rather than two.
    loader: ({ context }) => context.queryClient.ensureQueryData(pluginsListOptions),
});
